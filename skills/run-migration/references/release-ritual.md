# The release ritual, step by step

A schema migration is the one change in an app that cannot be taken back. Once a build or update
that carries version N reaches a phone, that phone's database is at version N for good: no store
release, older build or update rollback returns the file to N-1. This reference is the ritual around
one such change: what "shipped" means, the ledger that records it, the one-pending-version rule, the
moments to stop and ask, and the proof on both platforms. Writing the step itself (the runner, the
step file, rebuilds, fixtures) is persistence-and-migrations' job; this skill starts where a step
exists and ends when its version is recorded as shipped.

## Contents

- What "shipped" means
- The schema ledger
- One pending version (bump by one)
- Two branches that both add a version
- The ritual in order
- Upgrade over the previous release, on iOS and Android
- Store builds, EAS Update and rollbacks
- Shipping a step by EAS Update
- Adopting the ledger in an app that already shipped versions
- CI: comparing the ledger with the target branch
- Who owns what
- When multi-package

## What "shipped" means

A version is shipped the moment any build or update that carries its step runs on a device that is
not the developer's own machine or a disposable simulator: an App Store or TestFlight build, a Play
Store build or any Play testing track (internal, closed, open), an EAS preview build installed by a
tester, an ad-hoc or Firebase distribution, an EAS Update on any channel, preview included (every
preview build takes it, testers' too; ota-updates allows no private channel or runtime override that
would keep it to the developer's devices). The test is simple: could a database on a device other
than the developer's own now be at version N? If yes, version N is permanent.

Why so strict: an internal tester's phone holds real data too, and it is exactly the phone that
later installs the store build. If version N changed after a tester ran it, that phone and the store
population hold two different "version N" schemas, and the next step runs against both.

## The schema ledger

`contracts/schema-ledger.json` is the app's record of what reached a device:

```json
{
  "$schema": "./schema-ledger.schema.json",
  "shipped": [
    {
      "version": 1,
      "name": "create-lists-and-tasks",
      "stepSha256": "448a8539…7338",
      "fixtureSha256": "08cc5e6b…e6fd",
      "firstShippedIn": "1.0.0 (1)",
      "shippedOn": "2026-09-14"
    }
  ]
}
```

- One entry per shipped version, `1..N` in order, never a gap; append only. `record-shipped.mjs`
  writes entries; nobody types a hash.
- `stepSha256` and `fixtureSha256` are the sha256 of `src/data/migrations/vNNNN-<name>.ts` and
  `src/data/migrations/fixtures/db-vN.sql`, read with CRLF as LF (a Windows checkout hashes the same).
- `firstShippedIn` names the first build or update that carried the version (`1.4.0 (37)`,
  `update 3f2c… on production`), and `shippedOn` the day it left the machine.
- `contentTest` (a reason string) only on a version shipped before the app kept a ledger and that
  has no content test; `--adopt` writes it.
- `openPath` (optional, top level) when the app's `openAppDatabase` lives somewhere other than
  `src/data/app-database.ts`.

**Why a ledger when fixtures already have checksums.** persistence-and-migrations pins each fixture's
fnv1a32 in `fixture-checksums.ts` and replays every fixture to the latest schema. Two things slip
past that: (1) a shipped step whose schema stays the same while its data move changes (an edited
`UPDATE`, a different backfill value, a comment that hides a change of intent): the replay compares
schemas and counts rows, so it passes; (2) which versions shipped at all: without that fact, a
checker cannot tell "the pending step may still change" from "this step is frozen". The ledger pins
the step file's bytes, and it is the only place that fact lives.

**A formatter or a linter counts.** The hash is over the file's bytes, so anything that rewrites a
shipped step fails `shipped-frozen`: a Prettier upgrade that rewraps it, `npm run format`, a
repo-wide `eslint . --fix`, a mass autofix. Restore the file (`git checkout <ref> -- <step>`) and keep
the frozen steps out of those tools:

- **Prettier:** the line `src/data/migrations/v*.ts` in `.prettierignore` (the pending step is then
  formatted by hand, which suits literal SQL). typescript-and-lint-rules' canonical `.prettierignore`
  carries it, with a comment naming this skill; an app with an older copy adds the line.
- **ESLint autofix:** steps are linted, never fixed in bulk. `--fix` runs only on files you changed
  (the after-edit hook does exactly that, one file at a time); a bulk fix passes
  `--ignore-pattern 'src/data/migrations/v*.ts'`.
- **A new lint finding** (a rule added or upgraded): on the pending step, fix it, or add a file-level
  disable comment while the step is still pending. On a shipped step, leave the file as it is and turn
  that rule off for the shipped files by name in `eslint.config.mjs`
  (`files: ['src/data/migrations/v0001-create-lists-and-tasks.ts']`), never with a glob that also covers
  the pending step.

Do not re-record the hash: the ledger is append only.

## One pending version (bump by one)

At most one step is newer than the ledger. While version N is pending (no build with it has left the
machine), it is still a draft: change its SQL in place, re-dump its fixture, re-record its checksum.
Add version N+1 only after version N is in the ledger.

Why: every step that ships is run by every future install forever, and frozen forever. Two pending
steps v2 and v3 mean two permanent steps, two frozen fixtures and an every-path matrix that grows
for a version no phone ever needed (no build ever stopped at v2). It also hides the real question in
review ("what does this release do to my data?") across two files.

The rule also catches the common slip of numbering: the step files must run `1..N` without a gap
(`bump-by-one` reports `step files jump to version 3 after 1`).

## Two branches that both add a version

Two feature branches each add `v0002-…` while the ledger lists v1. The first to merge keeps v2. The
second must, before it merges, fold its change into the same pending v2 (one step, one fixture),
since nothing has shipped yet. If v2 already shipped from main, the second branch renumbers its step
to v3 (file name, `version: 3`, its position in `MIGRATIONS`, its fixture `db-v3.sql` re-dumped from
a v3 database, its content test loading `db-v2.sql`). `check-migration` on the merged tree reports
both cases: two pending versions (`bump-by-one`) or a v2 that no longer matches the ledger
(`shipped-frozen`).

## The ritual in order

1. **Baseline.** `node ${CLAUDE_SKILL_DIR}/scripts/check-migration.mjs .` passes on the tree before
   the change. A red baseline is fixed first (it is someone else's broken promise).
2. **Design the change** with persistence-and-migrations ("Adding version N+1"): a new step file,
   literal SQL, `rebuildsTables: true` for a rebuild, the repository and schemas updated in the same
   change.
3. **Content test first.** `test/sqlite/vNNNN-<name>.test.ts` loads `db-v(N-1).sql`, migrates, and
   compares values (references/proofs-and-drills.md, "The content test"). It fails before the step
   exists.
4. **Write the step**, append it to `MIGRATIONS`, run the content test until it passes.
5. **Freeze the pending fixture.** Open a database at version N, put representative rows in it
   (an apostrophe, a non-ASCII letter, an emoji, a NULL where a column allows it, a row in every
   table), dump it to `fixtures/db-vN.sql` with persistence-and-migrations' `inspect-database.mjs
   --dump`, record its checksum and its `FIXTURES` entry.
6. **Prove it on Node.** `npx jest test/sqlite --ci --maxWorkers=2` and `check-migration` (every
   path, the drill) until both pass.
7. **Prove it on devices** (next section): the previous release's build, then this one over it, on a
   named iOS simulator and a named Android emulator.
8. **Review.** One change holds the step, its test, the fixture, its checksum and the repository
   update, with a `Gate-Change:` trailer (fixtures are gated paths; git-commits-and-reporting). CI
   runs `check-migration . --base origin/main`.
9. **Stop and ask before it leaves the machine.** Tell the developer: "This release makes schema
   version N permanent on every phone that installs it: <one line of what changes>. Ship it?" When it
   goes out as an EAS Update, add the proof and the way back that is not one: "The Release build of
   this code ran crash-free over the previous release's data (for production: and on the preview
   update <id>). If it crashes before its first screen, expo-updates sends phones back to the
   previous update by itself, and a rollout revert or `eas update:rollback` does the same; those
   phones then run without their data until a fix-forward update arrives." Only on a
   yes does the release build or update go out (eas-build-and-submit, ios-release-testflight,
   android-release-play, ota-updates own those steps).
10. **Record it.** `node ${CLAUDE_SKILL_DIR}/scripts/record-shipped.mjs . --build '<build>' --ref <commit or tag>`
    prints the entry; after the release left, rerun with `--yes`, and commit the ledger (also gated).
    `--ref` names what the build was made from (EAS shows the commit on each build and update; a
    release tag works too): the entry hashes the step and fixture as that ref holds them, and
    record-shipped fails (rule `ref`) when the working tree differs from it or the ref lacks the
    step. Recording days later, on another branch or after an edit, then still pins what shipped.

## Upgrade over the previous release, on iOS and Android

Node proves the SQL. A device proves the rest: the build carries the step, the open path finds the
real file (`Documents/SQLite/app.db` on iOS, `files/SQLite/app.db` on Android), the snapshot lands
beside it, and the first screen handles the outcome. Do it on a device made for the job, never on a
booted or shared one; name it `<project>-migration`.

**iOS simulator** (verified commands; the app paths are your builds):

```sh
xcrun simctl create <project>-migration "iPhone 17"            # prints <udid>
xcrun simctl boot <udid>
xcrun simctl install <udid> build/previous/Tasks.app           # the previous release's build
xcrun simctl launch <udid> <bundle-id>                         # add tasks, lists, a hostile title
xcrun simctl terminate <udid> <bundle-id>
xcrun simctl install <udid> build/new/Tasks.app                # over it: the data container stays
xcrun simctl launch <udid> <bundle-id>
```

**iOS builds:** a store or TestFlight build does not install on a simulator, so check out the
previous release's tag and build it as a simulator Release build, the same way as the new one
(ios-simulator-build).

**Android emulator** (`install -r` replaces the app and keeps its data). Pin the console port, so
the serial is known before the emulator starts: without `-port` a second emulator takes the next free
one, and `emulator-5554` may be someone else's. If `adb devices` already lists `emulator-5580`, pick
another even port from 5554 to 5584 (the range the adb server finds emulators on by itself; a higher
port needs `adb connect`) and use it in every command. Create the AVD from a `google_apis` image, not
`google_apis_playstore`: only then does `adb root` work, which the file check of a Release build needs
(a Release build refuses `run-as`). Build both APKs in the same lane with the same signing key (check
out the previous release's tag and build it the same way): `install -r` over an APK signed with
another key fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, so an EAS-built previous release and a
locally built new one do not mix.

```sh
avdmanager create avd -n <project>-migration -k "system-images;android-36;google_apis;arm64-v8a"   # x86_64 on Intel
emulator -avd <project>-migration -port 5580 -no-snapshot &    # an AVD made for this; serial emulator-5580
adb -s emulator-5580 wait-for-device
until [ "$(adb -s emulator-5580 shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 2; done
adb -s emulator-5580 install previous.apk
adb -s emulator-5580 shell am start -W -n <package>/.MainActivity   # add data
adb -s emulator-5580 shell am force-stop <package>
adb -s emulator-5580 install -r new.apk
adb -s emulator-5580 shell am start -W -n <package>/.MainActivity
```

Then check the file: user_version N, every table's rows, integrity, a `.v<N-1>.bak` beside it. Load
persistence-and-migrations and run its `inspect-database.mjs` (`--udid <udid> --bundle-id <id>`, or
`--serial emulator-5580 --package <id> --android-root` after `adb -s emulator-5580 root`: a Release
build refuses `run-as`, which works only for the development variant or a local debug build) and its
kill test. These Android commands are command text checked against the tools' documentation; they
were not run on an emulator in this round. Clean up
afterwards: `xcrun simctl shutdown <udid> && xcrun simctl delete <udid>`, and
`adb -s emulator-5580 emu kill && avdmanager delete avd -n <project>-migration`. Which builds: a Release build of each version
(ios-simulator-build, android-emulator-build); a development build hides start-up timing.

## Store builds, EAS Update and rollbacks

A step is JavaScript, so under any runtime version policy (including `fingerprint`, which hashes
native inputs, not app code) an EAS Update can carry it. That is allowed, and it changes what a
rollback means:

- Neither store downgrades an installed app. Halting a phased release (App Store) or a staged
  rollout (Google Play) sends nobody back: users who updated keep N. Removing a version from sale
  changes no installed copy.
- What does put N-1 code on phones whose database is at N:
  (a) re-releasing the previous code under a higher build number or versionCode (what teams call a
  store rollback);
  (b) on iOS, a TestFlight tester installing an older build (the app's data is kept);
  (c) on Android, only `adb -s <serial> install -r -d` of a debuggable build: a lower versionCode from the store
  or a Play testing track installs only after an uninstall, which wipes the data;
  (d) `eas update:rollback`, which either republishes a previous update or tells clients to run the
  update embedded in the build (Expo docs, "Rollbacks");
  (e) ending an EAS Update rollout by reverting it. An update rollout ends by rolling out fully or by
  reverting; the safe stop is pausing the channel (`eas channel:pause <channel>`), which stops serving
  updates to phones that have not taken it yet and sends nobody back (phones keep what they run). `eas update:revert-update-rollout` republishes the control update (or
  creates a rollback-to-embedded update when the branch had none), so that "all clients are reverted
  back to the previous state"; for a branch rollout, `eas channel:rollout` > End > Revert "returns
  users to the old branch". Lowering a rollout's percentage is not documented either way: treat it as
  a revert. (Ending with Republish and revert keeps the new update and is fine.)
  (f) expo-updates' own error recovery, with no one deciding it. When the JavaScript throws a fatal
  error on an update's first launch on that device, before content appeared (about when the first
  view is on screen), expo-updates marks the update failed, looks for a newer one for about 5
  seconds, and otherwise relaunches the update that most recently launched successfully (or the
  embedded one). Expo's docs say the automatic rollback assumes nothing changed persistent state
  before the first render, and warn about updates that did. The canonical open path migrates before
  the first screen renders, so that assumption fails here: a crash anywhere after the step committed
  and before the first render (a provider, a font load, the first screen) puts N-1 code over a
  version-N file. After content appeared it only fixes forward. Expo marks this behaviour "subject to
  change".

Sources for (d) to (f), verified on 2026-10-16: docs.expo.dev/eas-update/rollbacks/,
/eas-update/rollouts/ and /eas-update/error-recovery/. Re-verify:
`curl -sL https://docs.expo.dev/eas-update/error-recovery.md | grep -n -A6 'content has not appeared'`
and `curl -sL https://docs.expo.dev/eas-update/rollouts.md | grep -n -i revert`.

On those phones the open path sees `newer-version`: it leaves the file untouched (the drill proves
it, part C) and runs the session in memory. Nothing is destroyed, and nothing the user saved is
visible until a build with step N arrives again; whatever they do meanwhile is lost at the next
launch. So: **never send a phone back past a shipped version; fix forward** with version N+1 (a step
that repairs what N did, from what the file still holds). Halting a store phased release or staged
rollout is fine; reverting an update rollout, `eas update:rollback` and a crash before the first
screen are not. `eas update:roll-back-to-embedded` is the same as rollback's embedded option and
counts as a rollback. Say this in the stop-and-ask message when the release goes out as an update.

## Shipping a step by EAS Update

The default: **a schema step ships in a store build.** It may ship as an EAS Update only inside
ota-updates' channel model (one channel per shipping variant, fixed in its builds; each update
published per channel, preview first, never promoted across channels), because (f) above turns any
crash before the first screen into a rollback nobody chose:

1. **Release-build proof first.** Rule 12's upgrade proof is the crash-free first render of the new
   JavaScript over old data: a Release build of the new code installed over the previous release's
   data on the named simulator and emulator, first screen with the user's data, then the file check.
   The release report cites it. Everything that can still change the step comes before step 2.
2. **Stop and ask, then publish to the preview channel.** Every preview build takes that channel,
   testers' included, so this publish ships version N (rule 9). On a yes, publish (ota-updates owns
   the publish and its preflight), then run `record-shipped.mjs --ref <the update's commit> --yes`.
3. **Prove it on a preview build that holds data.** On the developer's own preview build of the same
   native runtime (the update preflight names one), or on `<project>-migration` with a preview
   build, with data the previous version wrote (hostile text included): force-close and launch (the
   update downloads), force-close and launch again (it applies and migrates): the first screen shows
   the user's data. Check the file (persistence-and-migrations' `inspect-database.mjs`: user_version
   N, a `.v<N-1>.bak` beside it), then launch once more: it opens `ready` without migrating.
4. **The release report says:** "first-render path crash-free on Release build <ids> and on preview
   update <id>, <device>".
5. **Then production:** the stop-and-ask for production (ritual step 9, with the automatic-rollback
   line), and a publish with a staged rollout (ota-updates' `--rollout-percentage`).

If step 3 fails, version N has already shipped to the preview channel: pause it
(`eas channel:pause preview`) and fix forward with version N+1; never revert or roll back the preview
update. That is why the Node proofs and the Release-build proof come before the first publish. A
preview build has its own variant, config and so its own runtime, so a production update never
reaches it and a production build is never the preview proof; production gets its own staged rollout.

## Adopting the ledger in an app that already shipped versions

```sh
node ${CLAUDE_SKILL_DIR}/scripts/record-shipped.mjs . --adopt --build 'before the ledger' --ref <newest release tag>   # prints every entry
node ${CLAUDE_SKILL_DIR}/scripts/record-shipped.mjs . --adopt --build 'before the ledger' --ref <newest release tag> --yes
```

`--ref` names the newest release that carried those versions; drop it only when no such tag or
commit can be found, and say so in the report.

`--adopt` records every version in `MIGRATIONS` that the ledger lacks (it creates the ledger when it
does not exist). Versions from 2 without a content test get `contentTest: "shipped before the schema
ledger was adopted…"`; the every-path replay still covers them. Run it only for versions that
really shipped: if the newest one is still a draft, move its step aside, adopt, then bring it back
as the pending version. Stop and ask before `--yes`: the developer confirms which versions are out.

## CI: comparing the ledger with the target branch

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-migration.mjs . --base origin/main
```

With `--base`, a changed or removed ledger entry fails (`ledger-append-only`). The ref must exist in
the checkout: `actions/checkout` with `fetch-depth: 0` (a later `git fetch origin main` fails on a
private repository when the checkout set `persist-credentials: false`, which leaves no credentials); a
ref the checkout lacks is exit 2, never a silent pass. ci-pipeline-and-gates wires it: commit the
checker into the repo, wrap it in an npm script listed in quality-gates' `verifyExtraSteps` (for
example `"check:migration": "node scripts/checks/run-migration/check-migration.mjs . --base \"${GATE_BASE:-origin/main}\""`). A ledger that did not exist at the base is reported as
`(no ledger there yet)`. `--base-ledger <file>` compares with a file instead (tests, a release
artifact). Wiring the job is ci-pipeline-and-gates' work; the ledger, the steps and fixtures belong in
the reviewed (gated) paths.

## Who owns what

| Concern | Skill |
|---|---|
| The runner, the open path, snapshots, step files, rebuilds, fixtures, checksums, inspect-database, kill test | persistence-and-migrations |
| This ritual: the ledger, one pending version, content test, hostile rows, every path, the drill, recording, restoring a snapshot | run-migration |
| The `Gate-Change:` trailer and the release report | git-commits-and-reporting |
| The release build and the upload | eas-build-and-submit, ios-release-testflight, android-release-play |
| Publishing and rolling back updates | ota-updates |
| The CI job | ci-pipeline-and-gates |

## When multi-package

When the database lives in a workspace package, run every script with that package's folders:
`--data-dir packages/data/src/data --test-dir packages/data/test --contracts-dir packages/data/contracts`
(or `--migrations-dir` and `--ledger` directly). An `rn-skills.config.json` with `dataDir`, `testDir`
and `contractsDir` saves the options. One ledger per database.
