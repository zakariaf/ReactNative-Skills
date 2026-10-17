# The evidence folder, the runner and the checker

`rebaseline.mjs` runs each step and writes what it saw; `check-rebaseline.mjs` reads that evidence and
the tree and proves the ritual was followed. Both are zero-dependency Node scripts (Node 22 or newer)
and follow the output contract: `FAIL <file>:<line> [<rule>] <message> Fix: <fix>` per problem, then
`RESULT: PASS` or `RESULT: FAIL (<n> problems)`; exit 0 pass, 1 problems, 2 bad input.

## Contents

- The evidence folder
- before.json
- inspection.json
- rebaseline.mjs: modes, options, refusals
- check-rebaseline.mjs: rules
- Options and rn-skills.config.json keys
- What a passing run prints
- Known limits
- Troubleshooting

## The evidence folder

Default `reports/rebaseline/` (git-ignored with `reports/`; never committed):

| File | Written by | Holds |
|---|---|---|
| `before.json` | `--start` | the reason, the time, a sha256 of every golden path and every other repo file, every `[contract]` entry with a hash of its body, a digest of each snapshot's entries |
| `assertions.json` | `--assertions` | Jest `--json` of every project except the golden one |
| `triage.json` | `--triage` | Jest `--json` of the whole golden project without `-u` |
| `triage-diffs/*.png` | `--triage` | copies of the diff composites the triage wrote (an update deletes the originals) |
| `update-NN.json` | `--update <file>` | Jest `--json` of one `-u` run |
| `proof-01.json`, `proof-02.json` | `--proof` | Jest `--json` of the whole golden project without `-u`, twice |
| `proof-goldens.json` | `--proof` | `writtenAt` and a sha256 of every data and pixel golden the proof ran against (screenshot baselines excluded: the E2E run proves them) |
| `inspection.json` | `--update` (skeleton), then you | one entry per changed golden path |
| `commit-message.txt` | you | the planned commit message (`--message`) |

Golden paths: `**/*.golden.test.ts.snap`, `.snap.ios`, `.snap.android`; every PNG under an
`__image_snapshots__/` folder (never `__diff_output__/`); every PNG under `<e2eDir>/baselines/`
(screenshot baselines). Everything else the repo walk finds is frozen, including the pixel matcher,
`contracts/goldens.json`, the lockfile and the `goldenPaths` that register lists (golden vectors, data
fixtures), which never change in a rebaseline. The walk skips installed skills (`skills/`, `.agents/`,
`.claude/`, any folder holding a `SKILL.md`), `node_modules`, generated `ios/`, `android/`, build and
coverage output, `reports/`, `__diff_output__/`, `.stryker-tmp/`, `*.tsbuildinfo`, `expo-env.d.ts`.

Running the steps by hand works too, as long as each result lands under its name with `--json
--outputFile <evidence>/<name>` (for example `npx jest <file> --selectProjects golden --ci -u --json
--outputFile reports/rebaseline/update-03.json`). The runner adds the `--listTests` guard, the refusals
and the inspection skeleton. The proof is the exception: run it with `--proof`, since only the runner
writes `proof-goldens.json` and the checker needs it.

## before.json

Written once by `--start`; never edited (a changed record is exit 2: start over with `--restart`).
Keys: `version` (1), `startedAt` (ms), `reason`, `goldenProject`, `goldenTests`, `contractEntries`
(`[{ file, key, sha256 }]`), `snapshotDigests` (`{ path: sha256 }`), `goldens` and `frozen`
(`{ path: sha256 }`).

## inspection.json

```json
{
  "entries": [
    { "path": "src/features/tasks/tasks-digest.golden.test.ts.snap.ios", "verdict": "intended",
      "note": "both planDigest headers gain 'open 2'; the [contract] entries are unchanged; read line by line" },
    { "path": "test/goldens/__image_snapshots__/old-badge-golden-test-ts-draws-the-badge-1-snap.png", "verdict": "orphan",
      "note": "its test was removed in the previous commit; no test claims this image" }
  ]
}
```

- exactly one entry per golden path that differs from `before.json` (added, modified or deleted), and
  no other entry;
- `verdict`: `intended` for an added or modified path whose new content is what users should get;
  `orphan` for a deleted path no test claims. `todo` (the skeleton's value) means not inspected yet.
  Any other word (`regression`, `unsure`) is a stop: revert that path and fix the code, or ask;
- `note`: at least 15 characters saying what changed and why it is right; for a PNG, what the triage
  composite and the new image showed.

`--update` adds a `todo` entry (with `change`) for each newly changed path and drops `todo` entries of
paths that no longer differ; entries you wrote are kept.

## rebaseline.mjs: modes, options, refusals

```sh
node <skill>/scripts/rebaseline.mjs [repo-root] --start --reason "<cause>" [--restart | --dry-run] [--git-status <file>]
node <skill>/scripts/rebaseline.mjs [repo-root] --assertions [--max-workers 2]
node <skill>/scripts/rebaseline.mjs [repo-root] --triage [--diff-dir <dir>]
node <skill>/scripts/rebaseline.mjs [repo-root] --update <file>
node <skill>/scripts/rebaseline.mjs [repo-root] --proof
```

`--start` also lists the orphans that already exist (delete them during the ritual), and with
`--dry-run` runs every start check and prints the inventory without writing or deleting anything (a
quick health check of a repo before planning a rebaseline). `--git-status <file>` reads a captured
`git status --porcelain=v1 --untracked-files=all` instead of running git.

Common options: `--evidence-dir <dir>`, `--golden-project <name>` (default `golden`), `--jest
"<command>"` (default `npx jest`; words split on spaces), `--max-workers <n>`, `--json`. Jest's own
output streams through, then the script's lines and the RESULT line.

| Refusal (exit 1, nothing written) | Mode | Meaning |
|---|---|---|
| `install-matches-lock` | `--start` | a package in node_modules differs from package-lock.json, or is missing (optional and platform packages may be absent) |
| `goldens-dirty-at-start` | `--start` | `git status` shows a golden path with uncommitted changes (paths are taken relative to the app folder) |
| `contract-entry-changed` | `--start` | an orphan snapshot (its test file removed or moved) holds `[contract]` entries: deleting it would remove them, keeping it is an orphan; settle it with the reviewer before starting |
| `assertions-first` | `--assertions`, `--triage`, `--update` | the assertions run is red or partial, or missing before the triage or an update |
| `triage-first` | `--assertions`, `--triage`, `--update`, `--proof` | an update already ran (assertions and triage come first), or the triage is missing |
| `contract-entry-changed` | `--triage`, `--update` | a `[contract]` assertion fails, or an update targets such a file |
| `update-unplanned` | `--update` | the file neither failed nor held obsolete entries in the triage |
| `update-one-file` | `--update` | the `--listTests` preview lists anything but that one file, or `JEST_IMAGE_SNAPSHOT_TRACK_OBSOLETE` is set (with the outdated-snapshot reporter configured, the one-file run would delete other tests' baselines; `--start` only notes it) |
| `update-red` | `--update` | the file is still red after `-u` (a non-snapshot assertion fails); revert what it wrote |
| `proof-without-flag` | `--proof` | a proof run is red, partial or wrote a snapshot (it still writes `proof-goldens.json`) |

Exit 2: no `--reason` (or under 10 characters), a rebaseline already in progress without `--restart`,
`--dry-run` with `--restart`,
no golden test in the repo, `--update` of a file that is not an existing `*.golden.test.ts`, two modes,
or Jest writing no result (a config error stops it before any test). NOT APPLICABLE: no `jest` in
`package.json`.

## check-rebaseline.mjs: rules

```sh
node <skill>/scripts/check-rebaseline.mjs [repo-root] [--message <file>] [--evidence-dir <dir>] [--json]
```

| Rule | Fails when |
|---|---|
| `assertions-first` | `assertions.json` is missing, red, written before `--start` or after the first update, includes golden tests, or left out a non-golden test file under the test roots |
| `triage-first` | `triage.json` is missing, written before `--start` or after the first update, wrote snapshots, or left out a golden test |
| `update-one-file` | an update covered more or less than one `*.golden.test.ts`, ran without `-u`, or predates `--start` |
| `update-unplanned` | an updated file neither failed nor held obsolete entries in the triage |
| `golden-changed-unlogged` | a snapshot changed or was added and its test was never updated (a header-only rewrite excepted), or was deleted while its test exists; a pixel baseline changed and no updated test in its folder claims it, or was deleted while a test claims it |
| `inspection-record` | the record is missing while goldens changed, lacks a changed path, lists an unchanged one, has a verdict other than the one that fits (`todo` included) or a short note |
| `contract-entry-changed` | a contract entry recorded at `--start` changed or vanished (a renamed title deletes it), or an update ran on a file whose triage showed a failing contract assertion |
| `tolerance-changed` | the pixel matcher or `contracts/goldens.json` changed since `--start` |
| `source-changed` | any other file was added, changed or deleted since `--start` (at most 20 lines, then a count) |
| `install-matches-lock` | node_modules differs from package-lock.json now |
| `orphan-golden` | a golden snapshot whose test file is gone; a PNG under `__image_snapshots__/` that no golden test in the folder above claims |
| `proof-without-flag` | fewer than two proof runs after the last update (and the triage), or one that is red, wrote or updated snapshots, left obsolete entries or left out a golden test; `proof-goldens.json` is missing or older than the last proof run; or a data or pixel golden differs from it (edited, added or deleted after the proof) |
| `rebaseline-message` | with `--message`: no `Gate-Change:` trailer of at least 10 characters in a last paragraph made only of `Key: value` lines (the commit-msg hook's reading; a trailer beside prose is misplaced), or a re-accepted test file or deleted orphan not named |

Claims: a pixel golden claims the PNGs in `__image_snapshots__/` next to it whose names start with the
static part of its `customSnapshotIdentifier` (up to the first `${`), or with the kebab-cased test file
name when it sets none; a computed identifier claims every PNG in that folder.

## Options and rn-skills.config.json keys

| Key | Option | Default |
|---|---|---|
| `rebaselineEvidenceDir` | `--evidence-dir` | `reports/rebaseline` |
| `goldenProject` | `--golden-project` (runner) | `golden` |
| `pixelDiffDir` | `--diff-dir` (runner) | `reports/visual/diff` |
| `rebaselineTestRoots` | — | `src`, `test`, `scripts`, `plugins` and each workspace's `src` and `test` |
| `rebaselineIgnore` | — | extra globs left out of the frozen set (for example a generated file your tooling rewrites) |
| `goldensDir`, `pixelMatcher`, `goldensContract` | — | `test/goldens`, `<goldensDir>/skia-golden.ts`, `contracts/goldens.json` (the same keys golden-and-snapshot-tests reads) |

`contracts/goldens.json` supplies `contractMarkers` (default `["[contract]"]`) and `goldenPaths`.

## What a passing run prints

```
rebaseline: "<reason>"; 2 file(s) re-accepted, 4 golden path(s) changed
check-rebaseline: 10 golden paths checked, 0 problems
RESULT: PASS
```

With changed screenshot baselines the first line adds `(1 screenshot baseline(s): prove them with the
E2E screenshot compare run, e2e-maestro)`. Without a `package-lock.json` it notes that the install
could not be compared. There are no SKIP lines: every rule applies to every rebaseline. Without
`before.json` the checker stops with exit 2 (no rebaseline in progress), which is the expected result
in a repo where none is running.

## Known limits

- **Folder-level image claims.** A changed PNG counts as logged when any updated test in its folder
  claims it; two pixel golden files in one folder with overlapping prefixes can hide each other's
  hand edits. Give each a distinct literal identifier prefix.
- **What "looked at" means.** The checker proves an entry exists with a fitting verdict and a note; it
  cannot prove anyone opened the image. The developer's review before the commit covers that.
- **Screenshot baselines** are recorded and must be inspected, but are proven by the E2E compare run,
  not here.
- **Lockfiles other than npm's** (pnpm, yarn, bun) are not compared; a note says so.
- **`install-matches-lock` compares versions only**: each lockfile entry's version with the installed
  `package.json`. An `npm link`ed build that keeps the same version, an extraneous package installed
  with `--no-save` and patched file contents are not seen; `npm ci` before `--start` is the remedy.
- **The frozen set includes git-ignored files** the repo walk finds (a log, `.env.local`): one created
  during the ritual is reported `source-changed` although it can never land in the commit.
- **Hand-written Jest results** with plausible fields pass the evidence rules; the hashes of the tree
  still catch any golden or source change the results do not explain. `proof-goldens.json` is a
  record, not a signature: a hand-written one passes too. Both are deliberate bypasses that the
  developer's review before the commit is there to catch.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `source-changed` on files you did not touch | a tool rewrote them during the window (a formatter on save, a generated file), or a git-ignored local file appeared (`npm-debug.log`, `.env.local`: the frozen set includes git-ignored files) | revert them; delete the local file or list it in `rebaselineIgnore`; list truly generated files in `rebaselineIgnore` |
| `install-matches-lock` right after `npm install` | `npm install` changed the lockfile or kept extra packages | commit the lockfile change as part of the cause, run `npm ci`, `--start --restart` |
| `update-one-file` from the runner although the path is first | the golden project is not named `golden`, or the config lists the file in two projects | pass `--golden-project <displayName>`; check `npx jest <file> --selectProjects <name> --listTests` |
| `assertions-first` "left out" a test file | it lives outside the Jest test roots, or a project ignores it | move it into a test root, set `rebaselineTestRoots` to match the Jest config, or list it in `rebaselineIgnore` when the Jest config excludes it on purpose |
| `golden-changed-unlogged` after the Jest 30 header run | that run also wrote a new or changed entry | revert, find the test without a snapshot, start over |
| Jest wrote no result | a config or syntax error stops Jest before any test | read Jest's output above the RESULT line, fix, rerun the step |
| exit 2 "every test path in ... lies outside", or every file "left out" and goldens `golden-changed-unlogged` after moving the repo | the Jest results hold absolute paths from the old location (another worktree, a re-clone, a container path) | start over in the new location: `--start --restart --reason "<cause>"` |
| `proof-without-flag` "changed after the proof ran" | a golden was edited, re-accepted or deleted (an orphan) after `--proof` | restore it, or finish the change (`--update`, `git rm`), then rerun `--proof` |
| Jest printed `Deleting outdated snapshot "..."` | jest-image-snapshot's outdated-snapshot reporter ran with `JEST_IMAGE_SNAPSHOT_TRACK_OBSOLETE` set | restore the deleted baselines (`git checkout -- <path>`), unset the variable, `--start --restart` |
| `proof-without-flag` red on the second run only | the golden reads time, randomness or an unsettled animation | revert the goldens, fix the determinism (golden-and-snapshot-tests), start over |
