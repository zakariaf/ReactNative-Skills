# Definition of done and the evidence each change needs

A task is done only when every line that applies is true and its evidence is in the report. Numbers in
the report come from the files the tools wrote (`reports/`, Jest's summary, Stryker's report), never
from memory. git-commits-and-reporting owns the report's format; this page owns what evidence each
kind of change needs.

## Contents

- Always
- Evidence by kind of change
- The test pyramid
- Coverage and mutation gates
- Where the evidence files are

## Always

- Every new behaviour has a test that was run and seen failing for the right reason (an assertion, not
  an import or type error) before the code was written, and the test and the code are in the same
  commit.
- `npm run -s check:fast` is green. Before any push, `npm run verify` is green (the pre-push hook runs
  it).
- The checklist of every area touched was run (the skill for that area names it).
- No gate was weakened, no hook bypassed, and no `eslint-disable`, `@ts-ignore`, `.skip` or `.only` was
  added.
- `node ${CLAUDE_SKILL_DIR}/scripts/check-tests.mjs .` (the tree) and
  `node ${CLAUDE_SKILL_DIR}/scripts/check-test-edits.mjs . --range <base>..HEAD` (the new commits) print
  `RESULT: PASS`.
- The report quotes the red run's assertion lines and takes its numbers from the tools' output.

## Evidence by kind of change

| Change | Evidence required |
|---|---|
| Pure logic (domain rules, reducers, policies, selectors, date maths) | example tests + fast-check properties + one pinned exact value; coverage at or above the gates; for a finished module, a Stryker run of that file with survivors killed or explained |
| Goldens (data or pixel) and approved baselines | created or changed only on purpose, each changed PNG opened and looked at, a `Gate-Change:` trailer; a compatibility golden (an identifier or seed an installed version reads) never changes |
| Persisted data format (tables, columns, the save document) | a new schema version, a forward-only migration, a frozen fixture of the previous version, the migration test and a property over any valid old document, the repository tests on `node:sqlite`, then the device kill test on a simulator or emulator build |
| UI (screens, components) | component tests through the render helper with the accessibility audit clean; screenshots of each changed screen on the iOS simulator and the Android emulator, light and dark, the source locale and an RTL locale when the app ships one, edge-to-edge insets visible on Android, each looked at and compared with the approved design baseline; before a release, the full matrix |
| Navigation, deep links, first run | the route tests (`<feature>-navigation.test.tsx`), Android back and predictive back in an `.android.test.tsx` where the screen handles them, and the end-to-end flows that cover them passing on a Release build on both platforms |
| Native modules, config plugins, `app.config.ts` | `npx expo config --json` for every variant, a clean `npx expo prebuild`, a simulator build and an emulator build (EAS or the local lane), a launch screenshot looked at on each, the privacy and network audits |
| A new dependency | exact version from the stack table or `npx expo install`, at least 7 days old (or a dated exception), install script reviewed, licence allowed, knip clean (dependency-management) |
| Ads, purchases or Premium | fake-based tests for every affected rule (each numeric limit at exactly its value and one past it); purchases also a sandbox run on each store (StoreKit testing on iOS, a license tester on Play) before the store build |
| Accessibility-relevant UI | the audit line in component tests; a VoiceOver pass on iOS and a TalkBack pass on Android for the changed screens before a release |
| Anything that reaches users (a release) | the release checklist, end-to-end and screenshot runs green on this commit on both platforms, mutation score at or above 75%; the human checks (a play-through, a translation review, a store-listing review) listed in the report as steps for the developer, never waited for |

## The test pyramid

| Level | What | Tool / file | Speed | Runs in |
|---|---|---|---|---|
| 0 | Types, lint | `tsc` (both programs), ESLint | seconds | edit hook, pre-commit, `check:fast` |
| 1 | Pure logic: domain rules, reducers, policies, migrations | Jest `unit`, examples + fast-check properties, `<unit>.test.ts` | ms per test | pre-commit (related), `test`, `verify` |
| 2 | Data and pixel goldens | Jest `golden`, `*.golden.test.ts` | under a few seconds | same as level 1 |
| 3 | Integration in Jest: services over fakes, real SQL on `node:sqlite`, hooks, components, screens and routes with the testing library, Android-only behaviour | Jest `unit` and `android`, `test/integration/**`, `*.test.tsx`, `*.android.test.tsx` | 0.1-2 s per file | same as level 1 |
| 4 | Bot simulations (games plugin) | `*.sim.test.ts` via `jest.sim.config.js` | 10 s - 10 min | `test:sim` inside `verify`, never pre-commit |
| 5 | Mutation testing of logic folders | Stryker | 1-30 min | nightly, before a release, when a logic module is finished |
| 6 | End-to-end on a Release build | Maestro flows on a named iOS simulator and a named Android emulator | 10-60 s per flow | nightly, before a release, after UI or navigation changes |
| 7 | Screenshot matrix (light/dark x locales x both platforms x phone/tablet) | Maestro + image compare | 5-20 min | before a release, after any UI change |
| 8 | Store sandboxes and human checks | StoreKit testing / Play license testers, TestFlight / internal testing track, the developer's checks | manual | per release |

Most tests live in levels 1-3. A typical feature ships with dozens of level-1 and level-3 tests, a few
component tests per screen, one or two end-to-end flows and its screenshots.

## Coverage and mutation gates

- Coverage (unit-and-component-tests owns the configuration): global statements, lines and functions
  90%, branches 85%; logic keys (`./src/core/`, `./src/data/`, and the app's other logic folders)
  95/95/95/90. A threshold key becomes active once its folder has source files.
- Add tests for uncovered behaviour; never assertion-free tests (check-tests' `test-without-assertion`,
  `jest/expect-expect` and Stryker catch those), never `istanbul ignore`, never a lower number.
- Mutation (Stryker): run when a logic module is finished, nightly and before a release; the break
  threshold is 75%. Kill surviving mutants with boundary examples, never by relaxing thresholds.

## Where the evidence files are

| Artefact | Location | In git? |
|---|---|---|
| Data golden snapshots | `<test>.golden.test.ts.snap.ios` next to the test | yes, gated |
| Pixel golden baselines | `__image_snapshots__/<id>.png` next to the test | yes, gated |
| Pixel golden diffs | `reports/visual/diff/<id>-diff.png` | no |
| Coverage | `reports/coverage/coverage-summary.json`, `reports/coverage/lcov-report/index.html` | no |
| Mutation | `reports/stryker/mutation.json`, `reports/stryker/mutation.html` | no |
| End-to-end | `reports/e2e/<platform>/junit.xml` | no |
| Screenshot matrix | `reports/screenshots/<platform>/`; approved baselines under `design/baselines/` (or where design-visual-parity keeps them) | baselines yes, gated |
| Red and green runs of a slice | pasted in the slice plan and the report | in the report |
