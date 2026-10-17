# Golden policy: what a golden is and when it may change

Goldens are the frozen answers of the app. They exist because assertions forget things and because
one agent often writes both the code and its tests. This page is the policy; `data-goldens.md` and
`pixel-goldens.md` say how to write each kind, `checkers.md` how the two scripts prove it.

## Contents

- The kinds of golden
- Where goldens live
- How goldens are created and changed (the only way)
- The Gate-Change trailer and the golden paths
- Contract entries: append-only
- When a golden fails
- Obsolete and orphan snapshots
- Jest upgrades: the snapshot header
- What never becomes a golden
- iOS and Android
- When multi-package

## The kinds of golden

| Kind | What it pins | Test file | Stored as | Tolerance | Skill that owns it |
|---|---|---|---|---|---|
| Data golden | readable text a pure unit produces for fixed inputs (a plan, a schedule, a formatted summary, a parsed file) | `<unit>.golden.test.ts` next to the unit (Jest `golden` project) | `<file>.golden.test.ts.snap.ios` next to the test | exact | this skill |
| Contract entry | output every installed version must reproduce (formats, derived ids, date-keyed picks) | a `[contract] <unit> goldens` describe in a data golden, registered in `contracts/goldens.json` | the same `.snap.ios` | exact, append-only | this skill |
| Pixel golden | a Skia surface drawn by the same `draw()` the device runs | `test/goldens/<area>/<id>.golden.test.ts` | `__image_snapshots__/<id>-<size>-<moment>.png` next to the test | 0.1% of pixels | this skill (policy, matcher); skia-canvas-rendering (the surface test) |
| Screenshot baseline | a whole screen on an iOS simulator or Android emulator | the screenshot matrix | `.maestro/baselines/<platform>/<device>/<locale>-<theme>/<screen>.png` | 0.2% of pixels | e2e-maestro |
| Golden vectors | seeded generator output, filled by an independent oracle | `<feature>.vectors.json` + its test | the vectors file | exact, rows frozen | seeded-determinism-and-golden-vectors |
| Pinned literal | a compatibility value written as `toBe(...)` in an ordinary unit test (a hash of a fixed input, a migration checksum) | `<unit>.test.ts` | the test itself | exact | the skill that owns the unit |

The same policy covers every kind: it changes only on purpose, after a person-level look at the new
version, in a commit that says why. Pinned literals are goldens too: editing one follows the same rule,
even though no snapshot file is involved.

## Where goldens live

- The `golden` Jest project (from unit-and-component-tests' `jest.config.js`) matches only
  `*.golden.test.ts`, in every app: `npm run test:golden` and `-u` on one golden touch nothing else.
  While the app depends on `@shopify/react-native-skia`, the project runs in Skia's CanvasKit
  environment (`@shopify/react-native-skia/jestEnv.js` + `jestSetup.js`), so pixel goldens draw real
  pixels and data goldens run there unchanged.
- The project uses the `jest-expo/ios` preset, whose snapshot resolver writes
  `<file>.golden.test.ts.snap.ios` **next to the test** (inside `__tests__/` it writes
  `__tests__/__snapshots__/<file>.snap.ios`). Read in `jest-expo/src/snapshot/createPlatformResolver.js`
  and verified on 2026-10-04 in the reference app (jest 29.7.0, jest-expo 57.0.5). A project on the
  Android preset would write `.snap.android`; a golden never depends on the platform (see "iOS and
  Android"), so one file per golden is enough.
- Data goldens that need no Node API stay colocated in `src/` (`src/features/tasks/tasks-digest.golden.test.ts`).
  Pixel goldens read fonts with `node:fs` and use `Buffer`; the app program (`src/tsconfig.json`) has
  no Node types, so they live under `test/goldens/` (`@test/*` alias).
- Readable-text helpers for goldens live in `test/goldens/golden-text.ts`; a colocated golden imports
  them as `@test/goldens/golden-text`.
- Diffs are never committed: the matcher writes pixel diffs to `reports/visual/diff/`, jest-image-snapshot
  also uses `__image_snapshots__/__diff_output__/`, and `.gitignore` lists both.

## How goldens are created and changed (the only way)

1. Every script, hook and CI job runs Jest with `--ci`. `jest --ci` refuses to write a snapshot that
   does not exist ("New snapshot was not written. The update flag must be explicitly passed"), for data
   and image snapshots alike (verified on 2026-10-04). On a CI provider Jest turns `--ci` on by itself
   (the `CI` variable); locally it does not, so the scripts spell it out. `CI=false` or `--ci=false`
   turns it off and lets a run write new snapshots: never in automation.
2. Preview, then create or update the goldens of **one file**:

   ```sh
   npx jest src/features/tasks/tasks-digest.golden.test.ts --selectProjects golden --listTests
   npx jest src/features/tasks/tasks-digest.golden.test.ts --selectProjects golden -u
   ```

   The path comes first. `--selectProjects` takes several names, so in
   `npx jest --selectProjects golden <file> -u` Jest reads the path as a second project name, runs the
   whole `golden` project and rewrites every golden that differs (verified: `--listTests` lists every
   golden of the app in that order, only the one file with the path first).
3. Look at the result before anything else:
   - data golden: `git diff -- '*.snap.ios'`; every changed line must be what users should now get;
   - pixel golden: open every new or changed PNG under `__image_snapshots__/` with your file-reading
     tool (it shows images), and the diff PNG in `reports/visual/diff/` when there is one.
4. Rerun without `-u`: `CI=1 npx jest --ci --selectProjects golden` passes.
5. Commit the goldens together with the code that changed them, with a `Gate-Change:` trailer.

Hand-editing a snapshot is never the way: the next `-u` or a renamed test undoes it, and it records
something the code does not produce.

## The Gate-Change trailer and the golden paths

A commit that adds, changes or deletes a golden path carries a trailer in its last paragraph:

```text
feat(tasks): show undated tasks first in the digest

Undated tasks are the ones users forget; they now lead the upcoming group.

Gate-Change: planDigest golden for 2026-10-03 re-accepted; undated tasks lead the upcoming group (read the diff)
```

git-commits-and-reporting owns the message format; quality-gates owns `quality-gates.json`
`gatedPaths` and the commit-msg hook that rejects a commit touching a gated path without the trailer.
`check-golden-changes.mjs` checks the same thing for the staged change and for any range of commits.
The golden paths:

| Pattern | What it protects |
|---|---|
| `**/*.golden.test.ts.snap.ios` (and `.snap`, `.snap.android`) | data golden snapshots |
| `**/__image_snapshots__/**` (not `__diff_output__`) | pixel golden baselines |
| `test/goldens/skia-golden.ts` | the pixel matcher, which holds the 0.1% tolerance |
| `.maestro/baselines/**` | simulator and emulator screenshot baselines (e2e-maestro) |
| `contracts/goldens.json` | the register itself: the contract list, extra golden paths, `maxPixelTolerance` |
| `contracts/goldens.json` `goldenPaths` | anything else the app freezes, e.g. `**/*.vectors.json`, `src/data/**/fixtures/**` |

Find every gate change later with
`git log --format='%h %s%n%(trailers:key=Gate-Change)' --grep='^Gate-Change:'`.

A tolerance is a gate, not a golden: raising `failureThreshold` in the matcher or a screenshot
comparator's `MAX_DIFF_RATIO` needs the reviewer's agreement first, recorded in the trailer
(`Gate-Change: failureThreshold 0.001 -> 0.002 approved by <reviewer>: <reason>`), and the matcher's
limit `maxPixelTolerance` in `contracts/goldens.json` moves in the same commit. Lowering one needs only
the usual trailer.

## Contract entries: append-only

Some output is a promise to the past. Pin it in a describe titled `[contract] <unit> goldens` and
register it in `contracts/goldens.json`:

- a stored or exchanged format: a backup or export file, a CSV header, a share link or code a user
  sends to someone on another version;
- a derived identifier: a scheduled notification id an installed version cancels by, a deep-link path,
  a cache key, a hash of fixed input;
- a date-keyed pick that every device must agree on (a seeded generator's own contract is its vectors
  file, seeded-determinism-and-golden-vectors; a data golden that shows the same output readably is
  `[contract]` too).

The policy:

- **An existing entry never changes and is never deleted**, not even with a trailer.
  `check-golden-changes.mjs` fails any commit that edits or removes a line inside an entry whose key
  carries the marker. Adding keys is a normal Gate-Change commit.
- **The key is the title.** Renaming the describe or test title removes the old entry and writes a new
  one, so the history check sees a deletion (verified), even when the output is identical. Never rename
  a contract title; never remove its `[contract]` marker.
- **Pin at least three keys**, including the edges: for date keys a year-end/new-year pair
  (`2026-12-31`, `2027-01-01`) and a leap day (`2028-02-29`); for formats an empty input, a full one
  and a non-ASCII or right-to-left value. `check-goldens.mjs` fails fewer than three entries and date
  keys without the year-boundary pair.
- **If the producing code must change, stop and ask the reviewer.** The options: keep the old output
  and add a versioned one next to it (`encodeBackupV2`, a `"format": 2` field the reader understands),
  with a migration for what is already stored or scheduled; or switch inputs from a future date, so
  past keys keep their output. Breaking the contract for everyone on one release day is a product
  decision, never an agent's.

## When a golden fails

1. Read the failure. Data golden: Jest prints the snapshot diff (`- Snapshot` / `+ Received`). Pixel
   golden: `Expected image to match or be a close match to snapshot but was 3.7083333333333335%
   different from snapshot (6408 differing pixels)` and the diff PNG path.
2. Decide what the new output is:
   - **a bug** (a refactor changed an order, a format leaked a locale): fix the code; the golden stays;
   - **intended** (the change you just made): update that one file with `-u`, look at every changed
     entry or PNG, commit with Gate-Change;
   - **a contract entry**: always a bug (see above).
3. A golden that differs between two runs on the same commit means the code under test reads time,
   randomness or the machine's locale or time zone (the canonical Jest config pins `TZ=UTC`, but not
   the locale). Fix that, never the golden or the tolerance.
4. Many goldens at once after a dependency upgrade (Skia anti-aliasing, a new font): prove the old
   goldens pass on the old version first, then re-accept them in one dedicated commit following
   run-goldens-rebaseline.

## Obsolete and orphan snapshots

- An entry whose test was renamed or removed is **obsolete**: Jest prints `1 snapshot obsolete` and
  exits 1 even though every test passed (verified on 2026-10-04, with and without `--ci`). Remove it
  with `-u` on that one file, in a Gate-Change commit that says which test went away. A contract entry
  never becomes obsolete: its test is never renamed or removed.
- A snapshot file whose test file no longer exists is an **orphan**; delete it in the commit that
  removed the test (`snapshot-orphan`). Jest's own orphan cleanup matches only `\.snap$`, so this rule
  is the only thing that catches a `.snap.ios` orphan.
- A baseline PNG no pixel golden claims is an orphan too (`baseline-orphan`): jest-image-snapshot
  never reports unused images, and under `-u` it does not rewrite images that still pass within the
  tolerance (verified 2026-10-14). Its opt-in obsolete reporter (`JEST_IMAGE_SNAPSHOT_TRACK_OBSOLETE`,
  6.5.2) deletes every untouched default-named `*-snap.png` in the folders a partial run touched,
  without a record, and never sees `customSnapshotIdentifier` files: keep it unset and delete orphans
  by hand, in sight.
- A snapshot file of a test that is not `*.golden.test.ts` means someone snapshotted a component
  tree; delete it and assert roles and text instead (`snapshot-not-golden`).

## Jest upgrades: the snapshot header

Every snapshot file starts with `// Jest Snapshot v1, <guide link>`. Jest 29 writes
`https://goo.gl/fbAQLP`; Jest 30 (jest-expo 58, so Expo SDK 58) writes
`https://jestjs.io/docs/snapshot-testing` and, under `--ci`, fails every file that still has the old
link with `Outdated guide link` (jest-snapshot-utils `validateSnapshotHeader`, checked on 2026-10-10).
So the SDK move turns every golden red without a single changed entry. Rewrite the headers on purpose,
in the upgrade's own commit:

1. On the old Jest, `CI=1 npx jest --ci --selectProjects golden` passes with no obsolete snapshot.
2. Upgrade (expo-sdk-upgrade), then run `npx jest --selectProjects golden --ci=false` once by hand
   (no `-u`): Jest rewrites the header of each outdated file but keeps every entry, so a real diff
   still fails.
3. `git diff -U0 -- '*.snap' '*.snap.ios' '*.snap.android'` shows only line 1 of each file; anything
   else is a real change to triage first.
4. Commit with `Gate-Change: snapshot headers rewritten for Jest 30; header-only diff, checked with
   git diff -U0`. A header line is outside every entry, so contract entries count as unchanged.

## What never becomes a golden

- **Component trees** (`toMatchSnapshot()` on `render(...).toJSON()`): they change on every style tweak,
  and agents learn to answer every change with `-u`. Screens are proven by RNTL assertions
  (unit-and-component-tests) and screenshot baselines (e2e-maestro).
- **Inline snapshots** (`toMatchInlineSnapshot`): `-u` rewrites the test file, outside the gated
  snapshot paths. On this stack they cannot even be written: Jest 29.7 fails the suite with "Inline
  Snapshots are not supported when using Prettier 3.0.0 or above" (Prettier 3.9.9, verified).
- **Anything that depends on the clock, the machine's locale or time zone, or unseeded randomness**:
  `Date.now()`, `new Date()`, `Math.random()`, `toLocaleDateString()` without a locale, an `Intl`
  formatter without a locale. Pass a date key or an instant literal, a seed, an explicit locale.
- **Huge dumps nobody can review.** Describe the output: one header line and the fields that matter.
- **Objects as snapshots.** Snapshot one string per case, so the diff reads as lines, not as a
  pretty-printed object tree.

## iOS and Android

- Data and pixel goldens run in Node: they are the same for both platforms by construction. Keep the
  units they pin platform-free: a golden test imports no `react-native` (no `Platform.OS`), and code
  with a platform branch is tested in `<unit>.android.test.ts` under the Android preset
  (unit-and-component-tests), not in a golden.
- CanvasKit is not the device's renderer (Metal on iOS, Vulkan or OpenGL on Android): pixel goldens
  prove the draw code, a Release build on a named iOS simulator (`xcrun simctl io <udid> screenshot
  <file>`) and a named Android emulator (`adb -s <serial> exec-out screencap -p > <file>`) prove the
  device rendering. Never target "the booted simulator" or "the only device".
- Screenshot baselines are per platform (`.maestro/baselines/ios/...`, `.maestro/baselines/android/...`):
  fonts, system bars and edge-to-edge insets differ, so an iOS shot is never compared with an Android
  baseline. Freeze the status bar first (iOS `xcrun simctl status_bar <udid> override --time 9:41`;
  Android System UI demo mode through `adb -s <serial> shell`). e2e-maestro owns the matrix and the
  comparator; this policy (by hand, look first, trailer, 0.2% tolerance) applies to both platforms.

## When multi-package

In an npm workspaces repo (`apps/*`, `packages/*`), goldens live in the package that owns the unit:
`apps/mobile/src/.../<unit>.golden.test.ts` and `packages/<pkg>/src/.../<unit>.golden.test.ts`, run by
the one root Jest config. Pixel goldens live in the root `test/goldens/` or in a workspace's own
`<workspace>/test/goldens/` with its matcher beside them. The checkers read `package.json`
`workspaces`, skip each workspace's generated `ios/`, `android/` and `build/` folders, and accept a
matcher per workspace; point `rn-skills.config.json` `goldensDir` (and `pixelMatcher` when it is not
`<goldensDir>/skia-golden.ts`) at the folder that holds the pixel goldens, so the gated-path check
expects the right matcher path.
