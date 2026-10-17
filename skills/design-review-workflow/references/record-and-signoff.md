# The record, the fix round and the sign-off

One review is one folder, `design-review/<review-id>/review.json` (committed), plus its captures under
`reports/design-review/<review-id>/` (git-ignored, archived with the release). This page is the
record's format, its life from `new-review.mjs` to the sign-off, the one fix round, and the release
gate.

## Contents

- When a review runs
- The life of a record
- The record format
- Hashes: why the record keeps them
- The one fix round
- The sign-off
- The release gate
- In CI
- In the release report
- Keeping the captures

## When a review runs

Once per release (or once per large feature that ships on its own), at the end: every build task is
done and every gate and test is green on the commit to review. Never per task: blocking a build task
on a visual critique, or asking for review screenshots inside a task's acceptance criteria, is what
this workflow prevents. Something that looks wrong mid-build becomes a line in a notes file and waits
for the review.

## The life of a record

```
new-review.mjs .                     the record from the plan: every cell and video null, build facts
  capture the sweep                  references/capture-recipes.md
new-review.mjs . --refresh           hashes every capture present
  look, write findings               references/grading-rubric.md
  the on-device pass                 references/device-pass.md (results into the record)
new-review.mjs . --refresh           stores each finding's "seen" hashes (once per cell or video)
  the fix round: fix, verify, re-shoot the finding cells and re-record its videos on the fixed build
new-review.mjs . --refresh           new hashes; the finding cells and videos must differ from "seen"
  record the fix round, mark findings fixed, write the sign-off
check-review.mjs .                   RESULT: PASS on the machine that holds the captures
check-signoff.mjs .                  RESULT: PASS: the release gate, in CI too
```

`check-review.mjs . --in-progress` checks everything except the sign-off at any point; its summary
line counts cells, videos, findings per grade and the verdict.

## The record format

```json
{
  "$comment": "...",
  "version": 1,
  "id": "2026-10-14-1-2-0",
  "startedOn": "2026-10-14",
  "plan": { "file": "contracts/design-review.json", "sha256": "<64 hex>" },
  "screens": { "file": "contracts/screens.json", "sha256": "<64 hex>" },
  "build": { "variant": "preview", "appVersion": "1.2.0", "commit": "<sha>", "verify": "pass" },
  "cells": { "<cell name>": "<sha256 of the PNG, or null>" },
  "videos": { "<video name>": "<sha256 of the movie, or null>" },
  "devicePass": { "<hardware id>": { "model": "", "os": "", "date": "", "results": { "<step>": {} } } },
  "findings": { "F1": { "grade": "FIX", "lens": "identity", "what": "...", "cells": [], "status": "open", "openedIn": "sweep" } },
  "fixRound": null,
  "signoff": null
}
```

- `id` is the folder name, `<YYYY-MM-DD>-<slug>`; `new-review.mjs` defaults it to today and the app
  version (`2026-10-14-1-2-0`). Ids sort by day, so the newest review is the last folder.
- `build.verify` is `"pass"` only when `npm run verify` (or the app's full gate) passed on
  `build.commit`; the review starts after that, never instead of it.
- `new-review.mjs` writes the record laid out the way Prettier writes JSON, so the app's format check
  passes; hand edits are formatted with `npx prettier --write design-review/`.
- Unknown keys fail `review-record`; `fixRounds` is refused with its own message (one round).

## Hashes: why the record keeps them

- `plan.sha256` and `screens.sha256`: a sign-off covers the plan and the screens that existed when the
  review ran. A new screen, state or element afterwards makes the review stale (`review-stale`,
  `signoff-stale`); `--refresh` adds the new cells and drops the sign-off.
- `cells` and `videos`: the inventory proves which capture was looked at. A capture that changed after
  the inventory fails `review-cells` until refreshed and looked at again; a refresh that finds a
  changed capture after the sign-off drops the sign-off too (nobody who signed saw that shot), so the
  reviewer looks and signs again.
- `seen` in a finding: the hash of each named cell and video when the finding was recorded, keyed by
  its name (`--refresh` adds a name once, the first time it sees the finding naming a captured cell or
  video, and never changes it). A fixed BLOCKER or FIX whose cell still has that hash was never
  re-shot, whose video still has it was never recorded again, and one naming a cell or video with no
  `seen` hash cannot prove either (`review-fix-round`): the fix was not verified on its new capture.
  A motion finding ("the celebration plays again", a reduce-motion floor BLOCKER) is verified on its
  new video, the same way a layout finding is on its new shot.

## The one fix round

1. Consolidate the findings (one per cause). Fix every BLOCKER and FIX as one scoped change, each with
   its failing test first where a machine can catch it (tdd-workflow).
2. Run every gate and test again on the fixed commit.
3. Re-shoot only the cells and re-record only the videos the findings name, overwriting them (the
   folder stays one truth), and run again any failed device step.
4. Look at each new shot and watch each new video against its finding. Mark it `fixed` only when the
   new capture shows it fixed.
5. Record `"fixRound": { "commit": "<fixed commit>", "verify": "pass", "date": "<day>" }`.

What verification finds is recorded as a NOTE (`openedIn: "verify"`). A BLOCKER that survives the round
is `escalated`: no second round inside this review, no quiet iteration. The record ends
`NOT SIGNED OFF` with the escalation, and a new review starts after the fix.

## The sign-off

```json
"signoff": { "date": "2026-10-15", "reviewer": "<name or handle>", "commit": "<fixed commit>", "verdict": "SIGNED OFF" }
```

- `date`: the local day of the sign-off, after the review start and the fix round, never in the
  future (a sign-off written at 01:00 carries that local day, not the UTC day).
- `reviewer`: the person who looked. An agent that did the looking writes the person it worked for
  and asks them to confirm; it never signs for a person who did not see the review.
- `commit`: the build that was looked at: the fix round's commit when there was one, else
  `build.commit`.
- `verdict`: `SIGNED OFF` only with every BLOCKER and FIX fixed, every NOTE deferred with its backlog
  item or fixed, every cell and video captured, no failed device step. Otherwise `NOT SIGNED OFF` with
  `"escalation"`: which finding (`F<n>`) survived and who was told.

## The release gate

`check-signoff.mjs [repo-root] [--version x.y.z] [--commit <release sha>]` passes only when:

- the newest review whose `build.appVersion` is the version being released (default: the app config's
  `version`) exists and is `SIGNED OFF` (`signoff-missing`);
- its record holds up: findings, floor grades, device pass, fix round, sign-off (the `review-*` rules,
  without the captures, which CI does not have);
- the plan and the screen contract are unchanged since (`signoff-stale`);
- no user-facing path changed between the signed commit and the release commit (`signoff-ui-changed`).

The watched paths, each because a change there can change what people see:

| Path | Why |
|---|---|
| `src/`, `assets/` | the app's code, strings, images and fonts |
| `index.ts` (any root `index.*`) | the entry that runs before the router: the Intl polyfills, the error net |
| `app.config.*`, `app.json` | names, icons, appearance, orientation, plugins (build-number bumps aside, below) |
| every file `app.config.*` imports by a relative path, and what those import | the native app name and permission texts per language (`scripts/i18n/`), plugin options, variant identities |
| `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb` | the dependency set; a lockfile-only change is how a transitive bump (Dependabot, `npm audit fix`) lands |
| `babel.config.*`, `metro.config.*` | the transforms and the bundle: React Compiler, the Reanimated plugin, the env cache key |
| `eas.json` | the build profiles and their `EXPO_PUBLIC_*` values |
| `plugins/`, `patches/` | local config plugins (native changes) and patched packages |
| `.env`, `.env.*` (not `.env*.example`) | build-time values baked into the bundle |

Test files (`*.test.*`, `*.spec.*`, `__tests__/`), snapshots and `__mocks__/` are excluded. Anything
else (docs, CI files, store text, `scripts/` files the app config does not import) may change after
the sign-off. The imports are read from the release commit's working tree with one pattern over
`import ... from './x'`, `import('./x')` and `require('./x')`; a file the config reaches another way
(a path built at run time, `fs.readFileSync`) belongs in `signoff.watch`.

**Build-number bumps do not invalidate a sign-off.** Both local release lanes bump and commit a
counter in `app.config.ts` before every archive (`chore(release): build <n>`):
ios-release-testflight's `const IOS_BUILD_NUMBER = <n>;` and android-release-play's
`const ANDROID_VERSION_CODE = <n>;`, and the device pass itself spends numbers on TestFlight and Play
internal builds. The gate reads the app config's change hunk by hunk (`git diff -U0 <signed>..<release>
-- app.config.ts`) and counts the file unchanged when every changed line is such a counter (also an
older shared `const BUILD_NUMBER = <n>;`, or a literal `buildNumber` / `versionCode` value, in
`app.config.*` or `app.json`) or blank. One other changed line beside the bump, and the file is a
user-facing change again. With `--changed-from`, this needs the diff itself (below); a name list
cannot show which lines moved, so it counts every app config change.

The plan's optional `"signoff"` key adapts the list to the app, as globs on repo paths (`*` stays in a
folder, `**` crosses folders, a trailing `/` is a whole folder):

```json
"signoff": { "watch": ["native/", "shared-ui/**"], "ignore": ["src/dev-tools/**"] }
```

`watch` adds paths (a committed native folder, a second entry, a design folder outside `src/`);
`ignore` removes watched paths that never reach a person (a dev-only tool folder). It is part of the
plan, so changing it after a sign-off makes the review stale (`signoff-stale`), as it should: the gate
that judged the sign-off changed.

A ship gate never skips: no SKIP line, no NOT APPLICABLE. A change after the sign-off is either
reverted, or its screens are re-shot on the new build, looked at, and signed off again (a new review
of the same version, or a refreshed one).

## In CI

The gate reads only committed files and git history. A shallow clone lacks the signed commit: check
out with full history (`fetch-depth: 0` on GitHub Actions), or compute the list elsewhere and pass it:
`git diff -U0 <signed>..<release> > reports/changed.diff`, then
`check-signoff.mjs . --changed-from reports/changed.diff`. The file must be that diff (it starts with
`diff --git`) for a build-number bump to pass; a plain list of paths (`git diff --name-only`, one per
line) also works, and then any change to the app config fails the gate.

Run `node ${CLAUDE_SKILL_DIR}/scripts/check-signoff.mjs .` before the upload step of your release lane
(an EAS Submit job, a TestFlight or Play upload, the local lane): a red gate stops the upload. Add the
step to the lane the app uses yourself; ci-pipeline-and-gates, ios-release-testflight,
android-release-play and eas-build-and-submit own those lanes, and none of them is assumed to run it.

## In the release report

The release evidence report (git-commits-and-reporting) carries one Checks line and the open items:

```text
- Design review: 2026-10-14-1-2-0 SIGNED OFF by <reviewer> on 2026-10-15 (48 cells, 8 videos; 0 BLOCKER, 1 FIX fixed, 1 NOTE to #42)   design-review/2026-10-14-1-2-0/review.json
```

Every deferred NOTE is listed under "Not tested or not verified" with its backlog item, and the device
pass is named under "Human checks" with the day it ran.

## Keeping the captures

Captures are large and git-ignored (`reports/`). Archive the review's capture folder with the release
(a CI artifact, the release's attachments) for as long as the release is supported: it is what the
next review compares against when a person asks "was it like this before?". The record's hashes
prove which archive is the right one.
