# The rebaseline ritual, step by step

Re-accepting goldens overwrites the only record of what the app used to produce. It is the one test
operation that removes an assertion instead of running it, so it runs by hand, in a fixed order, with
evidence a checker can read. This page explains every step and why it is there. The commands use
`<skill>` for this skill's folder (`${CLAUDE_SKILL_DIR}` in SKILL.md).

## Contents

- When a rebaseline is the right tool
- Before you start
- The steps
- Reading a data golden diff
- Reading a pixel golden diff
- Triage: deciding what each failure is
- The two stop-and-ask moments
- The commit
- Special cases: Jest majors, renamed tests, new goldens, Skia upgrades
- Screenshot baselines (simulator and emulator)
- iOS and Android
- When multi-package

## When a rebaseline is the right tool

A rebaseline is for **many goldens moving for one known, deliberate cause**:

| Cause | Typical effect | Notes |
|---|---|---|
| A renderer or image-diff upgrade (`@shopify/react-native-skia`, its CanvasKit, `jest-image-snapshot`, pixelmatch) | anti-aliasing differs at shape edges in many pixel goldens | prove the old goldens pass on the old version first; the upgrade is the cause |
| A font file change (a new weight, a new version of the app font) | glyph edges move in every pixel golden that draws text | the font is loaded explicitly in pixel goldens, so the change is visible and deterministic |
| A design-token change (a colour, a stroke width, a radius used by drawn surfaces) | the drawn surfaces using that token change | the token change itself goes through design-system-structure |
| An intended redesign of a drawn surface or of a readable output format | the goldens of that surface or unit change | a format that installed versions read is a contract: never re-accepted |
| A Jest major (the snapshot header link) | line 1 of every snapshot file | a header-only rewrite, see "Special cases" |

One cause per rebaseline. Two unrelated causes (a Skia upgrade and a ring redesign) are two
rebaselines, each with its own triage and commit: otherwise every diff has two possible explanations
and neither can be checked against what its cause predicts.

It is **not** the tool for:

- **One golden that changed because of the change you are making.** That is the everyday flow of
  golden-and-snapshot-tests: `npx jest <file> --selectProjects golden -u`, look, commit with the
  trailer.
- **A red golden after a refactor that was not meant to change output.** That is a bug: fix the code.
- **A golden that differs between two runs on the same commit.** The code reads time, randomness or
  the machine's locale: fix that, never the golden.
- **A `[contract]` entry that changed.** Never re-accepted (see "The two stop-and-ask moments").
- **A diff just above the tolerance.** Raising a tolerance needs the reviewer's approval first, in its
  own commit (golden-and-snapshot-tests); a rebaseline never touches the matcher.

## Before you start

1. **The cause is final and in the working tree.** The dependency bump is installed, the token or the
   code change is made, its unit tests are written. From `--start` on, nothing but goldens may change:
   the checker compares every other file with the hash `--start` recorded (`source-changed`).
2. **Unrelated work is committed or stashed**, so the rebaseline commit holds only the cause and the
   re-accepted goldens.
3. **The goldens themselves are committed.** `--start` refuses uncommitted golden changes
   (`goldens-dirty-at-start`): the record must start from what the repository holds, or a hand edit
   made earlier would ride along unseen.
4. **`npm ci`.** The install must be exactly the lockfile: goldens written by a stale or hand-patched
   `node_modules` differ from what CI renders, and CI goes red on the next push. `install-matches-lock`
   catches a package at a version other than the lockfile's, or missing; it compares versions only, so
   `npm ci` is what also rules out a linked build with the same version, an extraneous package and
   patched file contents.
5. **`JEST_IMAGE_SNAPSHOT_TRACK_OBSOLETE` is unset** (`unset JEST_IMAGE_SNAPSHOT_TRACK_OBSOLETE`, and
   not exported by a shell profile, `.env` loader or CI step) for the whole ritual. With
   jest-image-snapshot's outdated-snapshot reporter in the Jest config, a one-file `-u` run with that
   variable set deletes every other test's default-named baseline in the same `__image_snapshots__/`
   folder, without a record (references/jest-facts.md). `--start` notes it and `--update` refuses while
   it is set; orphans are deleted by hand, with `git rm`, and recorded.
6. **No orphan snapshot holds a `[contract]` entry.** A contract golden whose test file was removed or
   moved leaves a snapshot that a rebaseline can neither delete (the contract entries would vanish) nor
   keep (an orphan): `--start` refuses it (`contract-entry-changed`). Settle it first, with the
   reviewer: move or restore the test so it claims its snapshot again (golden-and-snapshot-tests'
   one-file flow), or retire the contract in its own reviewed commit.

## The steps

| # | Command | What it proves |
|---|---|---|
| 1 | `node <skill>/scripts/rebaseline.mjs . --start --reason "<cause>"` | records `before.json`: a hash of every golden and every other file, every `[contract]` entry, a digest of each snapshot's entries; refuses a stale install, uncommitted goldens and an orphan holding contract entries |
| 2 | `node <skill>/scripts/rebaseline.mjs . --assertions --max-workers 2` | every Jest project except the golden one (`--ci --ignoreProjects golden`) is green and complete: the real assertions are the gate |
| 3 | `node <skill>/scripts/rebaseline.mjs . --triage` | the whole golden project without `-u` (`--ci --selectProjects golden`): the plan is the files that fail or hold obsolete entries; diff images are copied to `triage-diffs/` |
| 4 | read every failure; stop and ask | each failure is explained by the cause; the developer approves the plan |
| 5 | `node <skill>/scripts/rebaseline.mjs . --update <file>`, once per planned file | `--listTests` lists exactly that file, then `jest <file> --selectProjects golden --ci -u`; refuses unplanned files and files with a failing contract assertion |
| 6 | inspect each changed path; fill `inspection.json` | every changed golden was looked at and is what users should get |
| 7 | `git rm` orphans; record them (before the proof) | no snapshot outlives its test, no PNG outlives its claimant |
| 8 | `node <skill>/scripts/rebaseline.mjs . --proof` | the whole golden project passes twice with `--ci` and without `-u`, with no obsolete entry; `proof-goldens.json` records the goldens it ran against, so a golden touched afterwards needs another proof |
| 9 | `node <skill>/scripts/check-rebaseline.mjs .` | the evidence and the tree agree with every rule |
| 10 | stop and ask; write the message; `check-rebaseline.mjs . --message <file>` | the developer approved the record; the message carries the trailer and names every file |
| 11 | commit; `rm -r reports/rebaseline` | one dedicated commit; the next rebaseline starts clean |

Why this order:

- **Assertions before anything is re-accepted.** A golden asserts nothing about correctness; it only
  says "same as last time". Geometry, label, contrast and size assertions in the unit project are what
  can fail meaningfully. Re-accepting over a red unit suite freezes the bug into the goldens.
- **Triage before updates, on the whole golden project.** The triage is the plan. Updating a file that
  passed does nothing useful (Jest keeps a matching snapshot as it is) and updating files outside the
  plan is how unrelated drift sneaks in.
- **One file per `-u` run, path first.** After `--selectProjects`, Jest reads every following word as
  another project name, so `npx jest --selectProjects golden <file> -u` rewrites every golden that
  differs. The runner previews with `--listTests` and stops unless exactly that file is listed.
- **Proof twice, without the flag.** The first run proves the new goldens reproduce; the second
  catches a golden whose output changes from run to run (time, randomness, an unsettled animation).

## Reading a data golden diff

`git diff -- <file>.golden.test.ts.snap.ios` after the update, or `git diff -U0` for a long file.
Read every changed line and ask: is this exactly what the cause predicts? A header gaining a field is
expected after a format change; a reordered list after a token change is not. A changed entry under a
`[contract]` title is never acceptable (the runner refuses to update such a file, and the checker
compares every contract entry with its hash from `--start`).

## Reading a pixel golden diff

The triage run makes jest-image-snapshot write one composite per failing image into the matcher's
diff folder (`reports/visual/diff/<identifier>-diff.png` with the canonical matcher): the baseline on
the left, the differing pixels in red in the middle, the new render on the right. The next comparison
of that image deletes the file, so the runner copies every composite to
`reports/rebaseline/triage-diffs/` first. Open each composite and each new PNG with your
file-reading tool and check:

- the change sits where the cause says (an edge for anti-aliasing, a fill for a colour token);
- nothing else moved: text position, clipping at the narrow size, the start and end moments;
- the message gives the scale: `was 52.0% different from snapshot (2130 differing pixels)` is a fill
  change; a fraction of a percent at shape edges is anti-aliasing.

A colour change of one unit in one channel is below pixelmatch's per-pixel threshold and passes
without a diff (verified): pixel goldens do not prove exact colours; colour tokens are asserted in
unit tests.

## Triage: deciding what each failure is

| What the triage shows | Decision |
|---|---|
| The goldens the cause touches fail, with the diffs the cause predicts | plan them |
| A golden fails that the cause does not touch | stop: a bug or a second cause; revert nothing yet, fix the code or split the work, start over |
| A `[contract]` assertion fails | stop and ask the reviewer (never re-accepted) |
| An obsolete entry (a renamed or removed test) | plan that file: `--update <file>` removes the entry; a contract entry never becomes obsolete |
| A test errors before any snapshot (a thrown error, a missing font) | stop: fix it; `-u` does not fix code |
| Every snapshot file fails with "Outdated guide link" (a Jest major) | the header-only path under "Special cases": the list is the plan, one header run replaces the updates |
| (at `--start`) an orphan snapshot holding `[contract]` entries | `--start` refuses it: settle it with the reviewer before starting ("Before you start", item 6) |
| Nothing fails | nothing to re-accept; check whether the cause really changed rendering |

## The two stop-and-ask moments

**Before the first update** (after the triage), show the developer: the cause, the planned files, for
each pixel golden its composite, the obsolete entries, and the contract status ("no contract assertion
fails"). Wait for the go-ahead. Overwriting goldens is undoable with git, but the review it replaces is
not: the developer decides whether this set should move.

**Before the commit** (after `check-rebaseline.mjs` passes), show the developer the inspection record
and the PNGs (or attach them to the pull request), and wait for approval. The developer, not the agent
that wrote both the change and its goldens, is the second pair of eyes.

Stop and ask at any other point when:

- a contract entry differs: the options are a versioned format next to the old one, or switching
  inputs from a future date; breaking it is a product decision;
- a tolerance raise looks necessary: it goes through the reviewer and its own Gate-Change commit;
- a diff is not what the cause predicts and you cannot explain it.

## The commit

One dedicated commit holds the cause and the re-accepted goldens, nothing else, so every commit stays
green (an upgrade commit without its goldens would fail CI) and the history says what moved and why.
Write the message to a file inside the evidence folder (`reports/rebaseline/commit-message.txt`: a
message file elsewhere in the repo counts as an added file):

- a subject in the repository's commit format (git-commits-and-reporting);
- a body that names every re-accepted golden test and every deleted orphan;
- a last paragraph of trailers only, holding `Gate-Change: <which goldens, why, what you looked at>`
  (examples/rebaseline-commit.txt). Every line of that paragraph must read `Key: value`
  (`Co-Authored-By:`, `Signed-off-by:`, `Refs:` may sit beside it): a sentence in the same paragraph
  makes the commit-msg hook (git-commits-and-reporting) read the trailer as misplaced, and
  `--message` fails it the same way.

`check-rebaseline.mjs . --message reports/rebaseline/commit-message.txt` checks both. When
golden-and-snapshot-tests is installed, also run its history checker on the staged change: it enforces
the trailer and the contract rule on the commit itself. Then `git commit -F
reports/rebaseline/commit-message.txt` and delete `reports/rebaseline/`.

## Special cases: Jest majors, renamed tests, new goldens, Skia upgrades

- **A Jest major (Jest 30 with Expo SDK 58).** Every snapshot header changes from
  `https://goo.gl/fbAQLP` to `https://jestjs.io/docs/snapshot-testing`, and Jest 30 under `--ci`
  fails files with the old link (golden-and-snapshot-tests verified this in jest-snapshot-utils on
  2026-10-10). With the upgrade in place:
  1. `node <skill>/scripts/rebaseline.mjs . --start --reason "Jest 30 snapshot header"`;
  2. `node <skill>/scripts/rebaseline.mjs . --assertions --max-workers 2`;
  3. `node <skill>/scripts/rebaseline.mjs . --triage`: it lists every golden file failing on "Outdated
     guide link", and that list is the plan (anything failing for another reason is a stop);
  4. one run of `npx jest --selectProjects golden --ci=false` (no `-u`) rewrites the headers and keeps
     every entry. It replaces the `--update` step, so no `update-NN.json` is expected;
  5. fill `inspection.json` (one entry per rewritten file; `git diff -U0` must show line 1 only);
  6. `node <skill>/scripts/rebaseline.mjs . --proof` (it refuses without the triage), then the checker.
  The checker recognises a header-only rewrite (the entries digest equals the one `--start` recorded).
  Any entry change in that run is `golden-changed-unlogged`.
- **Renamed or removed tests.** Jest reports `1 snapshot obsolete` and exits 1; its hint ("To remove
  it, run `npm test -- -u`") would update the whole project: never follow it. `--update <file>` on
  that one file removes the obsolete entry and writes the renamed one. A whole test file removed
  leaves its `.snap.ios` behind: Jest's orphan cleanup only matches files ending in `.snap`, so
  jest-expo's `.snap.ios` orphans are never reported (verified); `git rm` them, unless one holds
  `[contract]` entries ("Before you start", item 6).
- **New goldens.** A new golden test is created with golden-and-snapshot-tests' one-file flow. Inside
  a rebaseline, a new test that fails the triage for a missing snapshot is planned like any other file
  and its update counts as `written`.
- **A Skia or CanvasKit upgrade.** Prove the old goldens pass on the old version (`npm run
  test:golden` before the bump), bump, `npm ci`, then the ritual. Under `-u`, jest-image-snapshot
  rewrites only images that fail the tolerance (`updatePassedSnapshot` is off); images within 0.1% keep
  their old bytes (verified). That is intended: small drift below the tolerance never needs a commit.

## Screenshot baselines (simulator and emulator)

Baselines under `.maestro/baselines/<platform>/<device>/<locale>-<theme>/` are written by the E2E
screenshot run (e2e-maestro), not by Jest. The same ritual applies with that tool: one device and
locale set at a time with its update flag, on a named simulator (`xcrun simctl` with a UDID) or a named
emulator (`adb -s <serial>`), never the booted or the only device. The checker records them at
`--start`, requires an inspection entry for each changed PNG and says that the E2E compare run proves
them; it cannot run devices itself.

## iOS and Android

Data and pixel goldens run in Node: the same files serve both platforms. The golden project uses the
`jest-expo/ios` preset, so data snapshots are `.snap.ios`; a project on the Android preset writes
`.snap.android`, and both are golden paths here. CanvasKit is not the device renderer (Metal on iOS,
Vulkan or OpenGL on Android), so a renderer upgrade is re-accepted in the pixel goldens and checked
on devices through the screenshot baselines, per platform.

## When multi-package

In an npm workspaces repo, run the scripts from the root that holds the Jest config. Golden tests in
`apps/*/` and `packages/*/` are found by the repo walk; the non-golden test roots follow each
workspace's `src/` and `test/` (or `rebaselineTestRoots` in `rn-skills.config.json`). `--start` reads
`git status` relative to the app folder when the git top level sits above it.
