# The release pipeline

How one commit becomes a signed Android App Bundle on a Google Play testing track, on either lane,
with the store-AAB gate between the build and the upload. Every outward step (an upload, a track
change, a tag push) needs the developer's word in this session.

## Contents

- Before the first release
- The EAS lane (default)
- The local lane
- The gate and the stamp
- Rehearsal without a key
- Version codes and tags
- Resuming and rebuilding
- After the upload
- When multi-package

## Before the first release

- `contracts/android-release.json` exists and is filled in (`templates/contracts/`), and
  `node <skill>/scripts/check-play-release-setup.mjs .` prints `RESULT: PASS`.
- The same commit already passed on Android: the Release emulator build (android-emulator-build), the
  E2E flows (e2e-maestro) and `npm run verify` (quality-gates).
- The human steps in human-steps.md are done or asked for in one message (account, app, App content,
  service account, testers).
- The developer said "upload" in this session.

## The EAS lane (default)

EAS Build makes the bundle with EAS-managed credentials; EAS Submit sends it. The order is
eas-build-and-submit's store release (its runbook is the one truth for the EAS lane; this skill adds
the gate on the bundle): build, the record check, the download, this gate, then `eas submit --path`
with the gated file; never `--latest`, never `--auto-submit`.

```sh
npm run -s verify                                      # or eas-build-and-submit's release preflight
mkdir -p build/release-android dist/eas
eas build --platform android --profile production --non-interactive --freeze-credentials \
  --message '<commit subject>' --json > dist/eas/builds.json    # AAB, autoIncrement versionCode; the build record
node <eas-build-and-submit>/scripts/check-eas-build.mjs . --build dist/eas/builds.json --platform android
# the record: id, appBuildVersion (the versionCode), artifacts.applicationArchiveUrl
curl -fsSL -o build/release-android/app-release.aab "<artifacts.applicationArchiveUrl>"
node <skill>/scripts/check-store-aab.mjs . --aab build/release-android/app-release.aab \
  --version-code <appBuildVersion> --stamp build/release-android/aab-gate.json
# with the developer's word:
eas submit --platform android --profile production --path build/release-android/app-release.aab --non-interactive
git tag -a v1.4.0+android.<n> -m "Play build <n>"
```

- **`--freeze-credentials` on every build.** Without it a non-interactive EAS build may update the
  project's credentials, which is the road to a second keystore for an application id Play already
  knows (signing-and-keys.md); with it, missing credentials fail the build instead. eas-build-and-submit
  states the same rule for every build.
- **The record check, then the gate.** eas-build-and-submit's `check-eas-build` proves what EAS built
  (commit, profile, application id, version, versionCode above the tags, fingerprint); this gate proves
  what is inside the bundle. Neither sees what the other sees, so both run before the submit.
- **`--path`, the gated bytes.** `eas submit --path` uploads the very file whose sha256 the stamp
  holds; that is the library's one submit form (eas-build-and-submit's preflight prints it, and
  ios-release-testflight uses it for the `.ipa`). `--latest` may pick another build, and `--auto-submit`
  uploads before the gate ever sees the bytes.
- **The artifact field is `artifacts.applicationArchiveUrl`**, the app archive: it is what
  `eas build:download` fetches (eas-cli 24.10.0, `commands/build/download.js`), and the field
  eas-build-and-submit's runbook downloads. `artifacts.buildUrl` is usually the same URL; when it
  differs, eas-cli treats it as an extra "build" artifact, so never gate that one.
- `eas.json` belongs to eas-build-and-submit: the production profile builds an `app-bundle` with
  `autoIncrement` and `appVersionSource: "remote"`, and `submit.production.android` names the
  testing track (`track` equal to the contract `uploadTrack`, `releaseStatus: "completed"`, or
  `"draft"` while the app is a draft in Play Console). Verified on 2026-10-14 against
  docs.expo.dev/eas/json and eas-cli 24.10.0's build fragment and `build:download`
  (`artifacts.applicationArchiveUrl`, `appBuildVersion`, `--freeze-credentials`).
- `eas build --auto-submit` uploads before the gate ever sees the bytes: never for Android, even from
  the store profile (`--platform ios` may keep it; the library states this once, in eas-build-and-submit). `check-play-release-setup`
  rule `gated-upload` fails `eas build ... --auto-submit` (also `-s`, `--submit`) and
  `eas submit ... --latest` with `--platform android`, `all` or no platform in `package.json` scripts,
  `.github/workflows/` and shell scripts; a quoted argument (`--profile "$PROFILE"`) does not end the
  command. It reads command text only: a command built in TypeScript, an EAS Workflows file
  (`.eas/workflows/`, a `type: submit` job after a build job), a minified `package.json` with several
  scripts on one line, or another CI system is reviewed by hand (eas-build-and-submit's `check-eas-config`
  reads EAS Workflows jobs and also refuses `--auto-submit` for Android, and its preflight never prints it
  for Android).
- With remote versions the counter lives on EAS, one per platform; tags take the per-platform form
  `vX.Y.Z+android.<n>`, and there is no release commit (git-commits-and-reporting).
- `eas build --local` builds the same bundle on the machine (it needs JDK 17 and the Android SDK);
  it is a debugging aid, not a second lane.

Before the submit, the other skills' gates that apply to the app run on the same commit and bundle:
a pending schema version (run-migration's `check-migration`) is named in the ask, because a testing
track makes it permanent, and recorded with run-migration's `record-shipped --build <n>` after the
upload; design-review-workflow's `check-signoff.mjs` passes for the version; privacy-and-store-declarations'
`audit-app-bundle.mjs . --android-manifest <merged.xml>` passes on the bundle's manifest
(`apkanalyzer manifest print build/release-android/app-release.aab`); and when the app has verified
links, deep-links-and-universal-links' `check-deep-links --release` and `write-well-known --check`
pass, with the app signing key's fingerprint (Play Console > Release > Setup > App signing) in
`assetlinks.json`, plus the upload key's while testers install upload-signed builds.

## The local lane

For teams without EAS: Gradle signs with the upload key, the Play Developer API uploads. Install the
templates first (SKILL.md workflow step 2).

`npm run release:android -- build [--notes "<what testers should check>"]`

| Step | What happens | Stops (exit 2, nothing changed) |
|---|---|---|
| preflight | contract lane local, the contract `releaseBranch` (default `main`), clean tree, `JAVA_HOME` and `ANDROID_HOME` set, the upload key at `~/.android-keys/<applicationId>-upload.jks` with mode 600; then `npm run verify` | any `preflightProblems`, `toolchainProblems`, `uploadKeyProblems` |
| version code | `nextVersionCode`: one above `ANDROID_VERSION_CODE` and every Android upload tag; written into `app.config.ts` and committed as `chore(release): build <n>` (body: Google Play) | `app.config.ts` without exactly one `const ANDROID_VERSION_CODE = <n>;` |
| prebuild | `npx expo prebuild --platform android --clean` with `APP_VARIANT` and `EXPO_PUBLIC_APP_VARIANT` = production for the whole run; afterwards `package.json` is written back when the prebuild only rewrote its `ios`/`android` scripts (`expo start --android` becomes `expo run:android`; `onlyScriptsRewritten`), so the tree stays clean for the next run | (exit 1, `build/release-android/logs/prebuild.log`) |
| bundle | `android/gradlew -p android bundleRelease --console=plain`; Gradle signs with the upload key | (exit 1, `build/release-android/logs/bundle.log`) |
| hand-off | prints the bundle path, its sha256 and the gate command | |

The number is spent from the commit on: a failed build never gives it back.

Then the gate (next section), then, with the developer's word:

`npm run release:android -- upload [--notes "..."] [--draft-app]`

| Step | What happens | Stops |
|---|---|---|
| stamp | `uploadProblems`: a stamp exists, is a PASS and not a rehearsal, has this bundle's sha256 and this application id; `usedVersionCodeProblems`: its versionCode is above every Android upload tag | exit 2, nothing sent |
| credentials | `loadServiceAccount`: the JSON key in `~/.android-keys/`, mode 600, read into memory once | exit 2 (human step) |
| upload | token, `edits.insert`, `edits.bundles.upload`, `edits.tracks.update` (the contract `uploadTrack`, `completed`, or `draft` with `--draft-app`; notes in `releaseNotesLanguage`), `edits.commit` (with `changesNotSentForReview=true` only under `--changes-not-sent-for-review`) | a `PlayStop`: exit 1, never retried |
| tag | `git tag -a vX.Y.Z+android.<n>` locally | |

Run a step by hand with the same environment:

```sh
export APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production
npx expo prebuild --platform android --clean
android/gradlew -p android bundleRelease --console=plain
"$JAVA_HOME/bin/keytool" -printcert -jarfile android/app/build/outputs/bundle/release/app-release.aab | head -3
```

The last line shows who signed it: the team's upload certificate, never `CN=Android Debug`.

## The gate and the stamp

```sh
node <skill>/scripts/check-store-aab.mjs . --aab <bundle> --version-code <n> --stamp build/release-android/aab-gate.json
```

Relative `--aab`, `--stamp`, `--contract` and `--tags-list` paths start at the repo root (the
positional argument), never at the folder the command runs in. It must print `RESULT: PASS`. Only
then does it write the stamp (a stamp path that cannot be written stops with exit 2):
`{ "result": "PASS", "sha256": "...", "versionCode": n, "applicationId": "...", "isRehearsal": false }`.
A FAIL writes nothing: fix the cause (never the gate, the contract to hide a finding, or a fixture)
and build again, which takes a new number. The local `upload` command refuses anything but a stamp
for these exact bytes; on the EAS lane the agent compares `shasum -a 256` of the file it submits with
the stamp before `eas submit --path`.

The gate reads the bundle itself, not the source: what the manifest merger, Gradle and every library
really produced. play-policy-and-artifact.md lists each rule and why.

## Rehearsal without a key

Before the upload key exists (or on a machine that must never hold it), prove everything but the
signature:

```sh
export APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production
npx expo prebuild --platform android --clean
android/gradlew -p android bundleRelease --console=plain      # falls back to the debug key
node <skill>/scripts/check-store-aab.mjs . --aab android/app/build/outputs/bundle/release/app-release.aab --rehearsal
```

`--rehearsal` prints `REHEARSAL: not a release gate` first, skips only the signing rule, keeps every
other rule strict and never writes a stamp. A report puts it under "Not tested or not verified",
never as release evidence. Template values (`com.example.*`, Google's sample AdMob id) still fail.

## Version codes and tags

- `versionCode` is an integer from 1 to 2100000000; Play refuses one it has already seen, for good,
  on any track. `versionName` (the app config `version`) is free for Play; the library keeps it rising
  with iOS so one tag history describes both apps (git-commits-and-reporting).
- **One counter per platform on both lanes.** EAS lane: `appVersionSource: "remote"` +
  `autoIncrement`. Local lane: one literal `const ANDROID_VERSION_CODE = <n>;` in `app.config.ts`
  feeds `android.versionCode` only; ios-release-testflight's local lane keeps its own
  `const IOS_BUILD_NUMBER = <n>;` for `ios.buildNumber`. Tags take the per-platform form on both
  lanes, `vX.Y.Z+android.<n>` beside the iOS twin's `vX.Y.Z+ios.<n>`, so an app that adopts both
  local lanes keeps one scheme (git-commits-and-reporting's tag check fails `build-scheme-mixed` when
  shared `+<n>` and per-platform tags meet in one app).
- An app that already shipped with one shared number (`const BUILD_NUMBER`, tags `vX.Y.Z+<n>`)
  switches only with the reviewer's agreement: rename the const to `ANDROID_VERSION_CODE` (iOS gets
  its own), keep the old tags, and tag per platform from then on. The first per-platform number is
  above every old shared tag (`nextVersionCode` and the gate count both forms), so nothing is reused.
  The history then holds both forms, which git-commits-and-reporting's `check-tags` reports as
  `build-scheme-mixed`; after the switch run it with `--match` globs for the per-platform tags so
  the old shared ones stay outside the check.
- The gate fails a versionCode that is not above every Android upload tag (`vX.Y.Z+android.<n>`, and
  the shared `vX.Y.Z+<n>` of an app that had it); iOS-only tags (`+ios.<n>`) do not count.
- Never lower a number after "version code already used": a number is spent; build again.

## Resuming and rebuilding

- After a gate PASS, `upload` is the only resume point (local), or `eas submit --path` with the
  gated file (EAS).
- A stop during the upload may leave an uncommitted edit on Google's side; a new run opens a new
  edit, and the stale one expires by itself.
- Changed bytes need a new build and a new number: the stamp's sha256 refuses a second upload of a
  rebuilt bundle under an old stamp.

## After the upload

- The release report (git-commits-and-reporting): version, versionCode, the gate's RESULT line, the
  track, the tag, and the human checks (install from the testing track, the purchase test with a
  license tester, TalkBack, the app's locales).
- Promotion to production is a staged rollout (tracks-and-rollout.md), a separate step with its own
  word from the developer.

## When multi-package

Pass `--app-dir apps/mobile` to both checkers: the app config and `eas.json` are read from that
folder and the gate reads tags under `mobile/` (`mobile/v1.4.0+android.15`). Run from the repo root,
the gate's paths are repo-relative, so it writes the stamp where the CLI (which runs in the app
folder) reads it with
`--stamp apps/mobile/build/release-android/aab-gate.json`, and takes
`--aab apps/mobile/android/app/build/outputs/bundle/release/app-release.aab` on the local lane. Keep one contract per
app, in the app folder: both checkers default to `<app-dir>/contracts/android-release.json`
(`--contract` or `androidReleaseContract` in `rn-skills.config.json` overrides it). The local lane's
tooling runs from the app folder: `apps/mobile/scripts/release-android/`,
`apps/mobile/scripts/clock/system-clock.ts`, `apps/mobile/plugins/with-upload-signing.ts`, and the
`release:android` script in `apps/mobile/package.json` (or the root one), run with
`npm run release:android --workspace apps/mobile`. `check-play-release-setup` looks for each of them
there (and stops with exit 2 when `package.json` declares workspaces but no `--app-dir` was given).
The CLI finds the app folder with `git rev-parse --show-prefix`: it tags `mobile/v1.4.0+android.15`
and commits `chore(mobile): build 15`.
