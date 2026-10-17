# Coverage gates and mutation testing (Stryker)

Coverage proves code ran; mutation testing proves the tests would notice if it were wrong. An agent
often writes both the code and its tests, so both gates exist.

## Contents

- Coverage thresholds
- How Jest applies the keys
- Files Jest cannot run: the device-only marker
- Keeping coverage green while adopting the skills
- Running a subset with coverage
- Reading coverage
- Why coverage is not enough
- Stryker configuration
- Running Stryker
- Reading the report and killing survivors
- A worked example: two boundary survivors
- Equivalent mutants

## Coverage thresholds

| Scope | Statements | Lines | Functions | Branches |
|---|---|---|---|---|
| global | 90 | 90 | 90 | 85 |
| `./src/core/` (pure domain) | 95 | 95 | 95 | 90 |
| `./src/data/` (repositories, migrations) | 95 | 95 | 95 | 90 |
| `./src/games/*/rules/**/*.ts` (games plugin) | 95 | 95 | 95 | 90 |

`npm run test:coverage` (`jest --ci --coverage --randomize`) runs every project and fails below these
numbers; `verify` includes it (quality-gates). The thresholds are gated values: lowering one is never a
fix. An app whose logic lives elsewhere names its folders in `contracts/test-setup.json`
(`logicCoverageKeys`) and adds the same keys to `jest.config.js`; the numbers stay.

Coverage is a gate here, not only a report, because the mutation score below is measured on the
logic set only; the global gate is what keeps screens, hooks and services tested at all.

## How Jest applies the keys

- A path key that matches no file makes Jest exit 1 ("Coverage data for ./src/... was not found"), so
  `jest.config.js` adds a logic key only once `fs.globSync` finds a non-test source file under it. A
  young app passes; the first `src/core` file switches its key on automatically.
- Directory keys (`./src/core/`) are checked as one total. A glob key (`./src/games/*/rules/**/*.ts`)
  is checked file by file, so every matching file must reach 95/95/95/90 on its own.
- Files matched by any key leave the `global` numbers.
- Tests under the root `test/` count toward the source files they exercise (the `src/data/` key is met
  by the `node:sqlite` tests under `test/`).
- `collectCoverageFrom` leaves out tests, `*.d.ts`, `fixtures/` and `testing/`, and nothing else
  (`check-test-setup.mjs` rule `coverage-scope` fails any other `!` glob).
- `coveragePathIgnorePatterns` holds `/node_modules/` plus one exact path per file marked device-only
  (next section), and nothing else (`coverage-device-only`).

## Files Jest cannot run: the device-only marker

Every source file either ships with a test or starts with this line in its first 6 lines (usually
line 2, after the path comment):

```ts
// device-only: covered by <the e2e flow or device check that exercises it>
```

The marker is only for four kinds of file: native adapters over a device API (the `expo-sqlite`
driver, the store-purchase adapter), Skia and frame-callback modules (a canvas, a frame clock),
composition files that only wire tested parts together (the root layout, `create-device-services.ts`,
a providers file), and tooling entry points that only wire a tested plan to a process. Fakes and pure
helpers never get it: they always get a test, because every other test leans on them.

One rule, three readers:

- `jest.config.js` takes its `coveragePathIgnorePatterns` from `deviceOnlyCoveragePatterns(__dirname)`
  in `scripts/quality/device-only.ts` (a template of this skill, with its test): exactly the marked
  files leave coverage, nothing else. The helper is a gated path.
- tdd-workflow's checkers accept a marked file as tested (and fail a marker that names no check).
- `check-test-setup.mjs` fails when a marked file is still counted, or when a hand-written exclusion
  hides an unmarked file.

The reason names a real check (`covered by the e2e smoke flow`, `covered by flow 03-language-switch on
iOS and Android`); a marker without `covered by <at least a few words>` counts as no marker. Route files
in `src/app/` are thin (they render a screen from `src/features/`), so the screen and its model hook
carry the tests. A route file is covered by the route test that renders its default export
(`src/features/<feature>/<feature>-navigation.test.tsx`, never a test beside it in `src/app/`:
`test-in-routes`), or it carries the marker naming the flow that opens it.

## Keeping coverage green while adopting the skills

The thresholds are global percentages, so copying runtime files whose tests arrive later lowers them
in between. In the source app, a step that copied providers and contexts before the tests that render
through the render helper dropped functions coverage to 89.8%. The rule that prevents it: a template and
its test land in the same commit, and when the test needs a later file (the render helper, the theme,
a store), both wait for it. A red `test:coverage` after adding files means a file was copied early or
a test is missing: add the test or move the file, never lower a threshold.

## Running a subset with coverage

Only `npm run test:coverage` judges the thresholds. A subset run with `--coverage` counts every file the
root config collects, so the global threshold fails with numbers like "0%" or "6.18%" even when every
file of the subset passes. Run a subset like this (paths first, because `--selectProjects` takes every
word after it as a project name):

```sh
npx jest src/features/reminders --ci --selectProjects unit \
  --coverage --collectCoverageFrom='src/features/reminders/**/*.ts' --coverageThreshold='{}'
```

Read the per-file numbers it prints; then run `npm run test:coverage` for the verdict.

## Reading coverage

`reports/coverage/coverage-summary.json` holds the numbers for the change report (`total.lines.pct`
and so on, plus one entry per file); `reports/coverage/lcov-report/index.html` shows uncovered lines.
Add tests for uncovered behaviour, never assertion-free tests (`jest/expect-expect` and Stryker catch
those), never `istanbul ignore` comments.

## Why coverage is not enough

In the source app's verification repo, line coverage was 97.8% while the mutation score was 77.1%.
Coverage counts executed lines; a test that runs a line without checking its result still covers it.

## Stryker configuration

`templates/stryker.config.json` and `templates/tsconfig.stryker.json`:

- **Scope: logic only.** `src/core/**`, `src/data/**`, every `*-policy.ts` and `*-reducer.ts` in
  `src/`, and the games plugin's rules and levels; tests, `testing/`, `fixtures/` and `test/`
  excluded. Screens are covered by component tests, flows and screenshots.
- `testRunner: jest` with `projectType: custom`, `configFile: jest.config.js`,
  `enableFindRelatedTests: true`; `coverageAnalysis: perTest`.
- `checkers: ["typescript"]` with `tsconfig.stryker.json`: mutants that do not compile count as
  errors, not kills. It is an app-world program (`jest` types, `src/**` only): the app's
  `src/app-env.d.ts` declares its own `process`, which clashes with `@types/node` in a combined program
  (`Property 'cwd' does not exist`, verified), and the tests under `test/` are type-checked by the root
  program anyway. Its own `tsBuildInfoFile` keeps it from overwriting the root program's build info.
  It extends `./tsconfig.base.json`, the shared base of typescript-and-lint-rules' tsconfig set, so
  adopt that set first. An app still on create-expo-app's default `tsconfig.json` (which extends
  `expo/tsconfig.base` and has no `tsconfig.base.json`) passed every other check, then Stryker stopped
  at start-up with `error TS5083: Cannot read file .../tsconfig.base.json` (verified);
  `stryker-tsconfig` fails an `extends` that does not resolve. Pointing `extends` at
  `./tsconfig.json` also works: this file's own `types`, `paths` and `include` win.
- `ignorePatterns` keeps generated native folders, reports and every agent-skill folder (`skills`,
  `.agents`, `.claude`) out of the sandbox copy: with installed skills inside it Stryker copied 16,152
  files instead of 338 and one file took 28 s instead of 17 s (verified; `stryker-config`).
- `disableTypeChecks: "{src,test}/**/*.{ts,tsx}"`: Stryker writes `// @ts-nocheck` atop these sandbox
  files so a mutant's type error cannot break the test run. Its default (`true`) means every
  `*.{js,ts,mjs,cjs,...}` file, root configs included, and Stryker 10 parses each with its own
  Babel 8, which `babel-preset-expo` (Babel 7) refuses: every run printed a 50-line
  `WARN DisableTypeChecksPreprocessor ... Requires Babel "^7.0.0-0", but was loaded with "8.0.6"` for
  `eslint.config.mjs` (verified 2026-10-03, Stryker 10.0.0). Narrowed to the mutated folders the
  warning is gone and the results are identical: on the same file, 6 mutants tested (2 killed,
  4 survived) and 3 compile errors, before and after the change. When
  multi-package, list the workspace folders: `"{apps,packages}/*/src/**/*.{ts,tsx}"`.
- `incremental: true` with `reports/stryker/incremental.json`: reruns reuse results for unchanged code.
- `ignoreStatic: true`: static mutants (code that runs when a module loads, such as module-level
  constants) are skipped, because each would rerun every test. A test file that calls the unit at
  module scope (`const TASKS = sortTasks([...])` above the `describe`) makes the unit's own code
  static: next section.
- `thresholds: { high: 90, low: 80, break: 75 }`: below 75% the run exits 1.
- Reports: `reports/stryker/mutation.json` (read by `check-mutation-report.mjs`) and `mutation.html`.
- In a mutation run, only the files Stryker instrumented compile without the Worklets and Reanimated
  Babel plugins (the override in `babel.config.js`, jest-config.md "babel.config.js"); every other
  file keeps them, so a related component test whose `useAnimatedStyle` has no dependency array still
  runs. The mutated logic is identical as plain JavaScript, and file-level-worklet modules stay in
  scope. The one test that checks the plugin's output is left out of mutation runs (`IS_MUTATION_RUN`
  in `jest.config.js`).
- Stryker honours `// Stryker disable` and reports those mutants as Ignored, outside the score
  (Stryker 10.0.0 has no option that turns the comments off); quality-gates' bypass check fails any
  such comment or `istanbul ignore`.

## Running Stryker

| When | Command | Time |
|---|---|---|
| A reducer, policy, repository or core module is finished | `npx stryker run --mutate <file>` | 20-30 s per file |
| Nightly and before a release | `npm run test:mutation` | a few minutes for a typical logic set |

Then: `node ${CLAUDE_SKILL_DIR}/scripts/check-mutation-report.mjs . --changed <file>` lists every
surviving or uncovered mutant of that file with its line and replacement, and fails when the overall
score is under 75% or the changed file has a survivor (`--report <file>` reads another report). After
the nightly run, `node ${CLAUDE_SKILL_DIR}/scripts/check-mutation-report.mjs .` (no `--changed`) checks
the score and fails on any file none of whose mutants was tested. In a young app Stryker also prints
one `WARN ProjectReader Glob pattern "src/data/**/*.ts" did not result in any files` line per logic
folder that does not exist yet; that is expected, and the line goes away once the folder has code.

## Reading the report and killing survivors

For each survivor:

1. Read the mutated line and the replacement (`lastSentMs > nowMs` became `lastSentMs >= nowMs`).
2. Ask which input tells the two apart; it is almost always a boundary (exactly the limit, the same
   millisecond, an empty list, the last index).
3. Add that example, see it fail against the mutant's logic (it passes against the real code), rerun
   Stryker on the file.
4. Or delete dead code the mutant exposed.

`NoCoverage` means no test ran the line at all: a missing example, often a whole branch (an action no
reducer test dispatches, for example).

**No valid mutant at all.** Verified on 2026-10-03 with Stryker 10.0.0 in the reference app: the only
test of `task-list.ts` computed its input with `const TASKS = sortTasks([...])` at module scope, so
perTest coverage tied every line of `sortTasks` to module loading, all 9 mutants became `Ignored`
("Static mutant (and "ignoreStatic" was enabled)"), and Stryker printed "Final mutation score of NaN
is greater than or equal to break threshold 75" and exited 0. With the call moved into the `it`
bodies, the same run tested 6 mutants and scored 33.3% (4 survivors). The same thing in a nightly run
is quieter: one file's mutants are all skipped, it drops out of the score, and the score of the other
files still passes. `check-mutation-report.mjs` fails every such file (`no-valid-mutant`), named with
`--changed` or not, and the whole report when no mutant at all was tested: a file whose mutants are
all `Ignored`, `CompileError` or `RuntimeError` proves nothing. Call the unit inside `it()`;
module-level fixtures are plain data.

One exception gets a note, not a failure: a file whose every mutant is a `CompileError`. Stryker's
TypeScript checker first compiles the unmutated project (a type error there stops the run: "Typescript
error(s) found in dry run compilation"), so a mutant that then fails to compile was rejected by the
types themselves. Verified on 2026-10-10 with Stryker 10.0.0 in the reference app: `npx stryker run
--mutate src/core/result.ts` (error-handling-typed-results' `ok`/`err`) made 12 mutants, all 12
`CompileError`, and printed a score of NaN; the types leave no change for a test to kill. A file that
mixes `CompileError` with `Ignored` mutants still fails.

## A worked example: two boundary survivors

The pattern comes from the source app, where Stryker left two survivors on a pacing policy that its
table and property did not kill; here it is restated on a reminder policy (at most three reminders a
day, none within 30 minutes of the last one):

```
[Survived] EqualityOperator  src/features/reminders/reminder-policy.ts:56:27
-  return last === null || last > nowMs ? null : nowMs - last;
+  return last === null || last >= nowMs ? null : nowMs - last;
[Survived] EqualityOperator  src/features/reminders/reminder-policy.ts:67:7
-  if (context.sentToday >= policy.maxPerDay) return false;
+  if (context.sentToday > policy.maxPerDay) return false;
```

Two examples at exactly the boundaries kill both:

```ts
it('blocks the fourth reminder of the day at exactly the limit', () => {
  expect(shouldRemind(request({ sentToday: 3 }))).toBe(false);
});

it('blocks a reminder in the same millisecond as the last one', () => {
  expect(shouldRemind(at(LAST_SENT_MS, LAST_SENT_MS))).toBe(false);
});
```

## Equivalent mutants

A mutant with no observable change (a bound that valid input never reaches) cannot be killed. Note it
in the change report with the file, line and why it is equivalent, and pass `--allow <mutant id>` to
the report checker. Never hide it with `// Stryker disable`, and never relax a threshold.
