# The checkers: check-goldens and check-golden-changes

Both are zero-dependency Node scripts (Node 22 or newer). They print one `FAIL <file>:<line> [<rule>]
<message> Fix: <fix>` line per problem and end with `RESULT: PASS` or `RESULT: FAIL (<n> problems)`.
Exit 0 pass (SKIP lines and NOT APPLICABLE included), 1 problems, 2 bad input or environment.

## Contents

- check-goldens: the tree
- check-golden-changes: the history
- Layout keys and the contract file
- Expected SKIP lines
- Known limits
- Using them in hooks and CI
- Troubleshooting

## check-goldens: the tree

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-goldens.mjs [repo-root] [--goldens-dir <dir>] [--matcher <file>] [--contract <file>] [--max-entry-lines <n>] [--json]
```

It reads files only (no Jest run): every `*.golden.test.ts`, every `.snap`/`.snap.ios`/`.snap.android`,
the pixel baselines next to pixel goldens, the matcher, `package.json` (root and workspaces), the hook,
lint-staged, agent and CI files, `quality-gates.json`, `.gitignore` and `contracts/goldens.json`. The
scan uses check-lib's repo walk: installed skills (`skills/`, `.agents/`, `.claude/`, ... and any folder
holding a `SKILL.md`), `node_modules`, generated `ios/`/`android/`/`build/` (also per workspace),
`coverage/`, `reports/` and `.stryker-tmp/` are never read. A folder without `package.json` is exit 2.

| Rule | Fails when | Fix |
|---|---|---|
| `golden-never-runs` | a `*.golden.test.tsx`, `*.golden.spec.*` or `*.golden.test.js` file exists | name it `<unit>.golden.test.ts` |
| `snapshot-missing` | a golden test calls `toMatchSnapshot` and has no snapshot file | create it on purpose with `-u` on that file |
| `snapshot-orphan` | a snapshot file's test is gone | delete it with the commit that removed the test |
| `baseline-orphan` | a PNG in an `__image_snapshots__` folder matches the identifier prefix of no pixel golden in the folder above it (jest-image-snapshot never reports unused images; a claim is a prefix, so overlapping prefixes can hide an orphan) | delete it with the commit that removed or renamed its test |
| `snapshot-not-golden` | a snapshot file belongs to a test that is not `*.golden.test.ts` | delete it; assert roles and text |
| `snapshot-unreadable` | an entry holds a component tree, or is longer than `--max-entry-lines` (120) | snapshot readable text; split or trim |
| `snapshot-not-text` | an entry is an object, array or number | snapshot one string per case |
| `inline-snapshot` | a golden test calls `toMatchInlineSnapshot` | use `toMatchSnapshot` |
| `golden-ambient` | a golden test calls `Date.now()`, `new Date()`, `Math.random()`, `performance.now()`, `toLocale*String()` or an `Intl` formatter without a locale (no argument, `undefined` or `[]`) | pass fixed inputs |
| `golden-renders-ui` | a golden test imports `react-native`, RNTL, a test renderer or a render helper, or calls `.toJSON()` | pin pure output; test UI in a component test |
| `contract-golden-missing` | a contract in `contracts/goldens.json` names a missing test, or its test has no describe title with a marker | write the test; title the describe `[contract] <unit> goldens` |
| `contract-unregistered` | a golden test has a describe title with a marker that `contracts/goldens.json` does not list, or the file is missing while such a describe exists | add `{ "id", "test", "why" }`; the first time, copy the template and replace its sample entry |
| `contract-golden-keys` | a snapshot holds fewer than 3 marker entries, or date keys without a Dec 31 / Jan 1 pair | add cases (never change one) |
| `pixel-golden-place` | a pixel golden lies outside the goldens folder | move it under `test/goldens/` |
| `pixel-matcher` | a pixel golden does not import `toMatchPixelGolden` from the matcher and extend `expect` with it | use the shared matcher |
| `golden-tolerance` | a test sets `failureThreshold`, `failureThresholdType`, `customDiffConfig` or calls `configureToMatchImageSnapshot`; or the matcher allows more than `maxPixelTolerance` (0.001, percent type) | remove it; restore the matcher |
| `matcher-missing` | pixel goldens exist but the matcher does not | copy `templates/test/goldens/skia-golden.ts` |
| `pixel-deps` | pixel goldens exist but `jest-image-snapshot` or `@types/jest-image-snapshot` is missing or not an exact version | install the verified exact pins |
| `pixel-golden-cases` | fewer than 3 canvas sizes without a `// fixed-size: <why>` line (a golden whose `draw:` is a function defined in the test is a pipeline smoke test and exempt), or an animated golden without `[0, 0.5, 1]` | render the size matrix and the moments |
| `baseline-missing` | no PNG in the `__image_snapshots__` folder next to the test starts with its snapshot id | create the baselines on purpose |
| `update-in-automation` | `jest -u`, `--updateSnapshot`, `--ci=false`, `CI=false` (or `CI: false` in a workflow `env:`) or a screenshot/baseline/golden script with `--update` appears in `package.json`, lefthook, husky, lint-staged, `.claude/settings.json`, GitHub Actions or EAS Workflows | remove it |
| `jest-without-ci` | a command in those files (`package.json` `scripts` and `lint-staged`, agent hook `command`s, every hook and workflow line except `#` comments, trailing ` # comments` and YAML label keys such as `name:`) runs `jest` (bare, `npx`, `npm exec`, `pnpm`, `yarn`, `bunx`) without `--ci`; `--listTests`, `--watch`, `CI=1`/`CI=true` before it and agent permission rules such as `Bash(npx jest *)` are exempt | add `--ci` |
| `gated-path-missing` | `quality-gates.json` exists and its `gatedPaths` lacks a golden path | add the path in a Gate-Change commit |
| `diff-output-ignored` | `.gitignore` lacks `reports/` or `**/__image_snapshots__/__diff_output__/` | add the lines |

Lines ending in a backslash are joined with the next before both automation rules run, so a
`npx jest \` / `--ci` pair counts as one command.

Sizes are read from `width:` values (numbers, or a `const NAME = 320` the test defines); a golden is
animated when it calls `timelineEndMs(`, defines `MOMENTS` or passes `elapsedMs:` anything but `0`. The
baseline id is the static start of `customSnapshotIdentifier` (up to the first `${`), else
jest-image-snapshot's default (the kebab-cased test file name).

## check-golden-changes: the history

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-golden-changes.mjs [repo-root] --range <base>..HEAD
node ${CLAUDE_SKILL_DIR}/scripts/check-golden-changes.mjs [repo-root] --staged --message <file>
node ${CLAUDE_SKILL_DIR}/scripts/check-golden-changes.mjs [repo-root] --log history.log
```

Exactly one mode. `--range` runs `git log`; `--staged` reads `git diff --cached` and the planned message;
`--log` reads a capture made with

```sh
git log --reverse -M -U200 -p --no-color --format='==> commit %H%n%B%n==> diff' <revs> > history.log
```

(`-U200` keeps each changed snapshot entry's `exports[` line in the diff context). Commits git writes
itself (`Merge `, `Revert "`, `fixup! `, `squash! `, `amend! `) are skipped, and so are paths under
installed skills and generated output.

| Rule | Fails when |
|---|---|
| `gate-change-missing` | a commit adds, changes or deletes a golden path and its message has no `Gate-Change:` trailer of at least 10 characters |
| `contract-golden-changed` | a commit removes or edits a line inside a snapshot entry whose key carries a contract marker (a deleted file and a renamed title count); never allowed, even with a trailer |
| `tolerance-raised` | `failureThreshold`, `MAX_DIFF_RATIO`, `PIXEL_THRESHOLD` (e2e-maestro's per-pixel colour distance), `maxDiffRatio` or `maxPixelTolerance` went up and the trailer does not say `approved` |

Golden paths: `**/*.golden.test.ts.snap`, `.snap.ios`, `.snap.android`, `**/__image_snapshots__/**`
(never `__diff_output__`), the matcher (configured path and `**/goldens/skia-golden.ts`),
`<e2eDir>/baselines/**`, `contracts/goldens.json` itself and its `goldenPaths`.

## Layout keys and the contract file

Paths come from check-lib's layout (`testDir`, `contractsDir`, `e2eDir`, workspaces) and these optional
`rn-skills.config.json` keys, each overridden by the matching option:

| Key | Option | Default |
|---|---|---|
| `goldensDir` | `--goldens-dir` | `<testDir>/goldens` (`test/goldens`) |
| `pixelMatcher` | `--matcher` | `<goldensDir>/skia-golden.ts` |
| `goldensContract` | `--contract` | `<contractsDir>/goldens.json` |

`contracts/goldens.json` (template and schema in `templates/contracts/`) is optional until a golden test
has a `[contract]` describe; a malformed file or an unknown key is exit 2:

| Key | Meaning |
|---|---|
| `contracts` | `[{ "id", "test", "why" }]`: each test must exist and carry a marker in a describe title, and every test with a marked describe must be listed |
| `goldenPaths` | extra globs that count as golden paths (history trailer, `gatedPaths`) |
| `contractMarkers` | marker strings (default `["[contract]"]`); add one only for goldens that already carry it |
| `maxPixelTolerance` | the highest `failureThreshold` (percent type) the matcher may hold (default 0.001); raised only with the matcher, after the reviewer approved |

## Expected SKIP lines

While an app adopts the policy step by step, a passing `check-goldens` run may print:

```
SKIP quality-gates.json [gated-path-missing] not yet created (quality-gates creates it)
SKIP .gitignore [diff-output-ignored] not yet created (typescript-and-lint-rules creates it)
```

`contracts/goldens.json` is this skill's own file, so it is never skipped: an app with no `[contract]`
describe may leave it out (or keep `"contracts": []`), and the first marked describe makes it required
(`contract-unregistered`).

## Known limits

The tree rules read text, not a shell or a type checker. These shapes pass although they break a rule;
a reviewer catches them:

- **Indirect runs.** A script that calls another script (`npm test` in a hook, `node scripts/run.ts`
  that spawns Jest, a Makefile) is judged by the line it names: `jest-without-ci` and
  `update-in-automation` see the `package.json` script that finally runs `jest`, never a program
  that builds the command. A `CI` variable set in a repository or organisation setting, or by `export`
  in an earlier line, is invisible.
- **Ambient input by indirection.** `golden-ambient` sees direct calls only: a helper imported from
  another file that calls `new Date()`, `Intl.DateTimeFormat(locale)` with a `locale` variable that is
  `undefined` at run time, or `Date` passed as a value, is not seen. Keep the inputs of a golden literal.
- **Sizes and moments.** `pixel-golden-cases` reads `width:` numbers or same-file constants and the
  literal `[0, 0.5, 1]`; sizes built in a loop or imported from a table need three literal sizes or a
  `// fixed-size:` line.
- **Contract keys per file.** `contract-golden-keys` counts marker entries per snapshot file, so two
  contract units in one golden file share the at-least-3 count: give each contract its own file or
  three keys of its own.

## Using them in hooks and CI

- **Before a commit:** `check-golden-changes.mjs . --staged --message <file>`; the commit-msg hook of
  quality-gates enforces the trailer itself, this adds the contract and tolerance rules.
- **In CI** (GitHub Actions or an EAS Workflow), after `actions/checkout` with `fetch-depth: 0`:
  `node <skill>/scripts/check-golden-changes.mjs . --range origin/main..HEAD` and
  `node <skill>/scripts/check-goldens.mjs .`. Both only read; neither ever writes a golden.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `snapshot-missing` although `-u` ran | the snapshot was written as `__snapshots__/<file>.snap` by a project without the jest-expo resolver, or under another name | run `-u` through the `golden` project (`--selectProjects golden`) |
| `pixel-golden-cases` on a one-size badge | the drawing has one true size | add `// fixed-size: <why>` near the top |
| `contract-golden-changed` on a pure rename | the snapshot key is the title | restore the old title |
| `gated-path-missing` in a monorepo for `test/goldens/skia-golden.ts` | the matcher lives in a workspace | set `goldensDir` (and `pixelMatcher`) in `rn-skills.config.json` and list that path |
| `git log ... failed` | not a git repository, or a range with no merge base | run in the repo; fetch the base branch in CI |
| `nothing to check: no staged change` | nothing is staged | `git add` first |
