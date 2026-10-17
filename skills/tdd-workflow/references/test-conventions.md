# Test names, places and limits

Where every kind of test lives, what it is called, what it must not do, and how flaky tests are
handled. `scripts/check-tests.mjs` checks the mechanical parts of this page; unit-and-component-tests
owns the Jest configuration that makes these names run (its projects select by suffix).

## Contents

- File names and places
- Titles
- Builders and tables
- What never goes in a test
- What not to test
- Snapshots and goldens
- Flaky-test policy
- When multi-package

## File names and places

| Kind | File | Where | Runs in |
|---|---|---|---|
| Unit, hook or component test | `<unit>.test.ts` / `<unit>.test.tsx` | next to the unit under `src/` | `npm test` (project `unit`), pre-commit (related), `check:fast` (changed) |
| Android-only behaviour | `<unit>.android.test.ts(x)` | next to the unit | project `android` (`jest-expo/android`) |
| Route test (Expo Router) | `<feature>-navigation.test.tsx` | `src/features/<feature>/`, never `src/app/` | project `unit` |
| Data golden | `<unit>.golden.test.ts` | next to the unit | `npm run test:golden`, `npm test` |
| Pixel golden | `<name>.golden.test.ts` | `test/goldens/` (needs Node APIs) | `npm run test:golden` |
| Integration with Node APIs (`node:sqlite`, `node:fs`, `Buffer`) | `<name>.test.ts` | `test/integration/<area>/` (or the area folder its helper lives in, such as `test/sqlite/`) | `npm test` |
| Perf budget | `<name>.perf.test.ts` | `test/integration/<area>/` (imports `node:perf_hooks`) | `npm test`, `verify` |
| Bot or balance simulation (games plugin) | `<name>.sim.test.ts` | `test/sims/<game-id>/` | `npm run test:sim` only, never pre-commit |
| Frozen persisted fixture | `fixtures/<name>-v<N>.json` / `.sql` | next to the migration tests | gated: changing it needs a `Gate-Change:` trailer |

Rules behind the table:

- **Colocate unit tests** as `<unit>.test.ts(x)` next to the unit. No `__tests__/` folders and no
  `.spec.ts` files: the Jest projects select by suffix, and a stray name is never run (Expo's own
  testing guide uses `__tests__/<name>-test.tsx`; move such files next to their unit).
- **Never put a test in the routes folder.** Expo Router bundles every file in `src/app/` as a route,
  so a test there breaks `expo export` while Jest still passes. A route test renders the route tree
  from `src/features/<feature>/` through the router helper of unit-and-component-tests.
- **Tests that need a Node API live under the root `test/` folder**, next to their helper. The app
  program (`src/tsconfig.json`) carries Jest types only and lint bans `node:*` imports in `src/`.
- **Import app code through the aliases**: `@/…` for `src/`, `@test/…` for the root test helpers, `./`
  for the same folder. Parent-relative imports (`../`) are banned by lint; jest-expo maps the aliases
  from `tsconfig.json`.
- **Every tappable or asserted element has a testID** `<screen>.<element>` in kebab-case
  (`tasks.add-button`, `tasks.task-row.12`), and every screen root `<screen>.screen`. End-to-end flows
  select by id, so they run unchanged in every locale and on both platforms (naming-conventions owns
  the format).

## Titles

- `describe('<exported name>')`, exactly the function, hook or component name.
- Optional `describe('when <condition>')` for a group of cases.
- `it('<third-person verb> ...')`: the first word is a verb ending in "s" or the word "can" (`returns`,
  `emits`, `keeps`, `rejects`, `shows`, `toggles`). The lint rule `jest/valid-title` enforces
  `^(can|[a-z]+s)\b` for `it`.
- Use `it`, not `test`.
- The title is the requirement sentence: `it('keeps cached Premium when restore finds nothing')`, not
  `it('restore test 3')`. Put the requirement ID in the title or a comment above it when the behaviour
  comes from a spec line: `it('returns today for a task due today (TASKS-12)')`.

| Good | Bad | Why |
|---|---|---|
| `it('returns today for a task due today (TASKS-12)')` | `it('should return today')`, `test('today')` | third-person verb, `it` only |
| `describe('taskUrgency')` then `describe('when the input is impossible')` | `describe('tests')` | exported name, then the condition |
| `it.each(...)('returns the right urgency %i days ahead', ...)` | 8 copy-pasted tests | tables for rule matrices |
| `it('keeps cached Premium when restore finds nothing')` | `it('restore test 3')` | the title is the requirement |
| `makeTask({ isDone: true })` | a 40-line object literal in every test | builders |

## Builders and tables

- Fixture builders are `make<Thing>(overrides)` (`makeTask({ isDone: true })`), in the test file or in a
  `testing/` folder next to the feature (`src/features/tasks/testing/make-task.ts`); check-tests does
  not require tests for `testing/` and `fixtures/` folders.
- Use `it.each` tables for rule matrices (every status of an entitlement, every limit at exactly its
  value and one past it). A row of a table is an assertion: changing or removing one is held to the
  same rule as changing an `expect(` line (check-test-edits reports it as `assertion-changed`), while
  adding a row or moving rows unchanged is fine. So is every line of an expectation Prettier wraps
  (`expect(` alone on a line, then the arguments, then `).toStrictEqual({` and the object's lines up to
  the matcher's closing line): moving a value inside it is a changed assertion, while a pure re-wrap
  (the same tokens, trailing commas aside) passes. With `--log` a wrapped line or a row is known only
  when the hunk shows the line that opens the `expect(` or the table; `--range` and `--staged` read the
  whole old file. A typed table (`it.each<[Args, Result]>([...])`, the template's form) counts the same.
- **A rename refactor passes.** In a `refactor` or `style` commit, an assertion line or row that was only
  renamed is not a changed assertion: it pairs with an added line of the same shape (every string,
  number and template literal, and every matcher name: `.toBe`, `.not`, `.resolves`, `.rejects`,
  asymmetric matchers after `expect.`, unchanged), each changed name follows one mapping across the
  whole commit, and the pairing really introduces a name: the old name no longer appears in the
  commit's new test or source code, and the new name appears nowhere in the old version of the
  commit's changed test and source files (`--range` and `--staged` read the whole old files from git;
  `--log` reads the diff's removed lines). So `planDigest(` -> `buildDigest(` passes, while
  `toBe('today')` -> `toBe('soon')`, `toBeGreaterThan` -> `toBeLessThan`, a name renamed two ways, two
  names swapped, or an assertion moved from `.openCount` onto a `.doneCount` that already existed (or
  onto a new `.pendingCount` while the code still returns `openCount`) are still `assertion-changed`:
  they move the assertion to another property and rename nothing. A rename inside a `feat` or `fix` commit gets no such pass: split it into its own
  `refactor` commit first.
- Keep helper functions outside `it` callbacks so the nested-callback limit (4 in tests) holds.

## What never goes in a test

- `.skip`, `.only`, `.failing`, `.todo` (also after `.concurrent`: `it.concurrent.only(`), `xit`,
  `xtest`, `xdescribe`, `fit`, `fdescribe`, `jest.retryTimes`.
- `Math.random`, `Date.now`, `new Date()` with no arguments, `performance.now()`, real `setTimeout`
  waits (`await new Promise((resolve) => setTimeout(resolve, 50))`: drive time with
  `jest.useFakeTimers()` and `await jest.advanceTimersByTimeAsync(ms)`, or let queued promises run
  with the `flushMicrotasks` helper of unit-and-component-tests, `@test/flush-microtasks`). The one
  exception: a perf budget test (`test/**/<name>.perf.test.ts`) times real work with `performance`
  imported from `node:perf_hooks`, because jest-expo replaces the global `performance.now` with a
  1 ms `Date.now` mock.
- What check-tests leaves to review: `jest.useRealTimers()` is allowed (an `afterEach` restores real
  timers with it after a fake-timer test, and the router render helper does the same), so a test that
  switches to real timers and then waits on a timer some other way is caught only by review and by
  Jest's open-handle detection (`--detectOpenHandles` on a hang).
- Native SDK imports (ads, purchases, audio): test through the port with its `fake-<port>.ts`; only an
  adapter's own test reads the SDK's root mock (unit-and-component-tests).
- Component-tree snapshots (`toMatchSnapshot` outside `*.golden.test.ts`).
- `node:*` imports in tests under `src/`.
- `Platform.OS = 'android'`: write `<unit>.android.test.tsx` instead.

## What not to test

- Component trees as snapshots, style objects, class names, private helpers or hook internals. Test
  behaviour through roles, accessible names and visible text.
- Third-party internals: navigation transitions, Skia's rasteriser, Reanimated's animation engine, the
  App Store and Play purchase sheets, Google's consent form content. Test your use of them (adapter
  mapping, your timeline, your draw calls).
- Translations' wording in component tests (catalog checks do that). Component tests assert source
  locale strings only.
- Layout and mirroring in Jest (there is no layout engine there): screenshots on the iOS simulator and
  the Android emulator do it.
- Timing with real clocks, sleeps or `setTimeout` waits; the network; the device's locale or time zone.
- Trivial type-only modules, re-exports, constants tables (covered by the tests that use them).
  check-tests treats a module as logic when it exports a function, a class or a function-valued
  `const`, directly or through a local `export { name }` list. A module whose only runtime export is an
  object of functions (`export const noteReducerCases = { add: (state) => ... }`, a migration object
  with `up`) is not detected: such objects are often tested through the registry that imports them,
  so the coverage gate of unit-and-component-tests holds them. Give one its own test when nothing else
  reaches it.
- Thin device-only wrappers that Jest cannot load (the expo-sqlite driver, a file-system adapter, a
  composition file): Jest runs the same logic through a Node driver or a fake, and the device check
  covers the wrapper. Mark such a file in its first 6 lines with
  `// device-only: covered by <the e2e flow or device check that exercises it>`. check-tests then
  skips it (and fails a marker that names no check), jest.config.js leaves it out of coverage through
  `scripts/quality/device-only.ts`, and check-test-edits lets a `feat`/`fix` commit that changes only
  such wrappers pass `code-without-test` (with `--range` or `--staged` it reads the marker from git;
  with `--log` only when the diff shows the file's first lines). Fakes and pure helpers are never
  device-only: they get tests. An adapter that has a root mock is not device-only either.
- The same behaviour at two levels without a reason: a rule proven by properties does not need an
  end-to-end flow; the flow proves the wiring.

## Snapshots and goldens

- No component-tree snapshots: agents rubber-stamp large UI snapshots with `-u`.
- Snapshots exist only in `*.golden.test.ts` as readable data (text grids, JSON).
- Create or change a golden only on purpose: `npx jest <file> --selectProjects golden -u`,
  never `-u` in scripts or hooks, and commit with a `Gate-Change: <reason>` trailer. `jest --ci` refuses
  to write new snapshots. golden-and-snapshot-tests owns the details.
- A golden that is a compatibility contract (an identifier an installed version reads, a daily seed for
  a past date) never changes; a new format is a new function.
- Open every changed golden PNG or screenshot before committing it.

## Flaky-test policy

A flaky test passed and failed on the same commit. It is a bug in the test or the product, found early.

1. **Jest:** no retries, no skips. Rerun with the printed seed:
   `npx jest --ci --randomize --seed=<n> -i <file>`. Typical causes: shared mutable module state (use
   factories), real timers, time zone, unawaited promises, order dependence. Fix the cause in the same
   session.
2. **fast-check:** never flaky by definition; a new failure is a new counterexample.
3. **Pixel goldens:** renders are byte-identical run to run; a varying golden means the draw path reads
   time or randomness.
4. **End-to-end flows (iOS simulator and Android emulator):** rerun the failing flow once alone, on the
   same named device (`maestro --device <udid-or-serial> test <flow>`). If it then passes, it is flaky:
   fix the wait (wait on an id, never a sleep), the setup or the app. A retry is allowed only around
   system dialogs (permission prompts, the Android "app not responding" dialog), never around app
   assertions. If the fix needs more than the current session, tag the flow `quarantine` with a dated
   comment, report it in the evidence, and fix it within 7 days. A smoke flow is never quarantined.
5. **Screenshots:** rerun once. A diff in a different place on each run means the screen is not still
   (animation, clock, a blinking caret, the Android status bar); fix the setup, not the tolerance.

## When multi-package

In an npm-workspaces repo (`apps/*`, `packages/*`), every rule above applies per workspace: tests sit
next to their unit inside the workspace's `src/`, Node-API tests in the root `test/` folder, and a
workspace imports another by its package name (`@acme/core/money`), never through `../`. The checkers
read `package.json` `workspaces`: each workspace's `src/` is app code (no `node:` imports in its tests),
each workspace's routes folder holds no test, and the default logic globs repeat per workspace. Set
`logicGlobs` and `sourceGlobs` in `contracts/tdd.json` when a package keeps its logic elsewhere.
