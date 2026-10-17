# Verified Jest facts the ritual depends on

Each fact below was verified on 2026-10-14 in the reference Expo SDK 57 app (jest 29.7.0, jest-expo
57, jest-image-snapshot 6.5.2, Node 26.4), by running it or by reading the installed source. Re-verify
after any Jest, jest-expo or jest-image-snapshot upgrade with the command given.

## Contents

- Choosing what runs
- When Jest writes snapshots
- Obsolete entries and orphan files
- Pixel goldens (jest-image-snapshot)
- The --json result
- Jest majors

## Choosing what runs

| Fact | Evidence | Re-verify |
|---|---|---|
| After `--selectProjects`, every following word is read as another project name. `npx jest --selectProjects golden <file> --listTests` lists every golden; `npx jest <file> --selectProjects golden --listTests` lists only that file | ran both | the two `--listTests` commands |
| `--ignoreProjects golden` runs every other project (here `unit` and `android`: 168 test files, the same set a file search finds) | ran it; compared with `find src test scripts plugins -name '*.test.ts*'` minus golden and sim tests | `npx jest --ignoreProjects golden --listTests` |
| `--listTests` writes nothing and needs no `--ci` | ran it | — |

## When Jest writes snapshots

| Fact | Evidence | Re-verify |
|---|---|---|
| `--ci` makes `updateSnapshot` `none` unless `-u` is given; `--ci -u` is `all` | `jest-config/build/normalize.js`: `newOptions.ci && !argv.updateSnapshot ? 'none' : argv.updateSnapshot ? 'all' : 'new'` | `grep -n "updateSnapshot" node_modules/jest-config/build/normalize.js` |
| Without `--ci`, Jest is in CI mode only when `ci-info` detects a CI provider; locally a run without `--ci` writes missing snapshots (`new`) | `jest-config/build/Defaults.js`: `ci: _ciInfo().isCI` | same file |
| Under `--ci`, a test without a stored snapshot fails: "New snapshot was not written. The update flag must be explicitly passed to write a new snapshot." | ran a renamed test | rename a golden test title, run with `--ci` |
| `-u` on one file rewrites only that file's mismatching entries and removes its obsolete ones; matching entries stay byte for byte | ran it: `1 snapshot removed, 1 snapshot written, 7 passed` | — |

## Obsolete entries and orphan files

| Fact | Evidence | Re-verify |
|---|---|---|
| An obsolete entry (its test renamed or removed) makes the run fail: `success: false`, `snapshot.unchecked: 1`, "1 snapshot obsolete" | ran it with `--ci` | rename a test title, run the file with `--ci` |
| Jest's hint for obsolete entries names a whole-project update ("To remove it, run `npm test -- -u`", or the matching `npx` form) | printed by the run | — |
| Jest's orphan cleanup matches only files ending in `.snap` (`\.snap$`); jest-expo writes `.snap.ios` / `.snap.android`, so an orphan snapshot file is never reported and never deleted, with or without `-u` | `jest-snapshot/build/index.js` `cleanup()`; ran an orphan `.snap.ios` through `--ci` (passes) and `-u` (survives) | `grep -n "EXTENSION" node_modules/jest-snapshot/build/index.js` |
| jest-expo's platform resolver writes `<test>.snap.<platform>` next to the test (inside `__tests__/` it writes `__tests__/__snapshots__/`) | `jest-expo/src/snapshot/createPlatformResolver.js` | read the file |

## Pixel goldens (jest-image-snapshot)

| Fact | Evidence | Re-verify |
|---|---|---|
| It counts into Jest's snapshot state: `updated`, `added`, `matched`, `unmatched` appear in the `--json` summary like data snapshots | `jest-image-snapshot/src/index.js` `checkResult()`; a `-u` run reported `updated: 1` | `grep -n "updateSnapshotState" node_modules/jest-image-snapshot/src/index.js` |
| Under `-u` it rewrites only images that fail the tolerance (`updatePassedSnapshot` defaults to false); a within-tolerance image keeps its old bytes | `diff-snapshot.js` `shouldUpdate()`; ran `#208AEF` → `#208AF0`: passed, PNG unchanged | — |
| By default nothing reports or deletes an unused baseline PNG: `-u` leaves it, and no run lists it | README "Removing Outdated Snapshots"; the matcher (`src/index.js`, `src/diff-snapshot.js`) deletes only the received image and the diff output, never a baseline | `grep -n -e unlink -e rmSync node_modules/jest-image-snapshot/src/*.js` |
| An opt-in `outdated-snapshot-reporter` deletes them: added to Jest `reporters` and run with `JEST_IMAGE_SNAPSHOT_TRACK_OBSOLETE` set, every matcher call appends its baseline path to `.jest-image-snapshot-touched-files` in the working directory, and at the end of the run the reporter deletes every `*-snap.png` in a touched folder that the run did not touch, printing only `Deleting outdated snapshot "<file>"...` to stderr | `src/outdated-snapshot-reporter.js` (`IS_ENABLED`, `onRunComplete`); the README warns never to use it on a partial suite | `ls node_modules/jest-image-snapshot/src/outdated-snapshot-reporter.js && grep -n -e TRACK_OBSOLETE -e -snap.png node_modules/jest-image-snapshot/src/outdated-snapshot-reporter.js` |
| What that means for a rebaseline: a one-file `--update` run is a partial suite, so with the reporter configured and the variable set it deletes the live baselines of every other test sharing that `__image_snapshots__/` folder, without a record. It sees only default-named `-snap.png` files: a `customSnapshotIdentifier` baseline such as `harness-badge.png` is never deleted, and never reported as unused either. With the variable set but no reporter, the touched-files list is left at the repo root (a `source-changed` finding). Hence: unset the variable for the whole ritual, delete orphans by hand; `rebaseline.mjs --update` refuses while it is set | read the source above | same command |
| The default identifier is `kebabCase(<test file basename>-<test name>-<counter>)` + `-snap`; a `customSnapshotIdentifier` replaces it | `createSnapshotIdentifier()` in `src/index.js` | read the function |
| A failing comparison writes `<identifier>-diff.png` (baseline, red differences, new render, side by side) into `customDiffDir`; the next comparison of that image deletes it first (`fs.rmSync(diffOutputPath)`) | `diff-snapshot.js`; the diff was gone after the `-u` run | — |
| A one-unit change in one colour channel stays under pixelmatch's per-pixel threshold and passes | ran it | — |
| Under `--ci` a missing baseline fails the test (`_updateSnapshot === 'none'`) | `src/index.js` | — |

## The --json result

`jest ... --json --outputFile <file>` writes the aggregated result. The fields the scripts read:

```json
{
  "success": true,
  "startTime": 1791984740643,
  "numFailedTests": 0,
  "numTotalTests": 9,
  "numRuntimeErrorTestSuites": 0,
  "snapshot": { "added": 0, "updated": 0, "unmatched": 0, "unchecked": 0, "didUpdate": false,
                "uncheckedKeysByFile": [{ "filePath": "/abs/path/x.golden.test.ts", "keys": ["..."] }] },
  "testResults": [{ "name": "/abs/path/x.golden.test.ts", "status": "passed", "startTime": 0, "endTime": 0,
                    "assertionResults": [{ "ancestorTitles": ["[contract] ..."], "title": "...", "status": "passed" }] }]
}
```

`name` and `filePath` are absolute (the scripts make them repo-relative, real paths included, so a
`/tmp` symlink does not matter). `snapshot.didUpdate` is true exactly when the run had `-u`.
`testResults` has no project name: the scripts tell golden and non-golden files apart by file name.

## Jest majors

Expo SDK 58 brings Jest 30 (jest-expo 58). Jest 30 writes the snapshot header
`// Jest Snapshot v1, https://jestjs.io/docs/snapshot-testing` and, under `--ci`, fails every file that
still carries the Jest 29 link (`https://goo.gl/fbAQLP`) with "Outdated guide link"; a run without
`--ci` and without `-u` rewrites the header and keeps the entries. Read on 2026-10-14 in the registry
tarballs of `@jest/snapshot-utils` 30.2.0 (`getSnapshotData`: with `updateSnapshot` `none` it throws
the header error, with `new` or `all` it marks the file dirty so it is saved with the new header) and
`jest-circus` 30.2.0 (the snapshot state is built in `initialize()` of `jestAdapterInit.js`, before
any test). So under `--ci` the whole file fails before any assertion runs: the triage plans every
such file and reports no failing `[contract]` assertion for it. Not run here, since Jest 30 is not
installed in the reference app. Re-verify after the SDK move:

```sh
npx jest --version && grep -rn "Outdated guide link\|validateSnapshotHeader" node_modules/@jest/snapshot-utils/build node_modules/jest-snapshot/build 2>/dev/null | head -3
```
