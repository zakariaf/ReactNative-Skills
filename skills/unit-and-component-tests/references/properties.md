# Examples, fast-check properties and pinned values

How pure logic (reducers, policies, repositories' mapping, migrations, date and money helpers, game
rules) is proven: examples for the spec sentences, properties for everything else, and at least one
pinned exact value. Also where the other logic-level tests (simulations, SQL) run.

## Contents

- Why all three
- fast-check in an Expo app
- playActions: properties for any reducer, policy or rules engine
- The property checklist
- When fast-check finds a counterexample
- Pinned values and independent oracles
- Simulations (only with jest.sim.config.js)
- Storage and migration tests on node:sqlite

## Why all three

Examples read as the spec and pin exact behaviour; properties explore inputs nobody thought of; a
pinned value (a golden number, sequence or state) catches a change that keeps every property true. In
the source app's probes, determinism and range properties alone left 3 of 8 mutants of the
random-number generator alive; the pinned sequence killed them. So every pure module gets examples
and properties and one pinned value in its test file.

## fast-check in an Expo app

- `fc.assert(fc.property(arbA, arbB, (a, b) => { expect(...); }))`. The lint config's
  `jest/expect-expect` accepts `fc.assert` as an assertion.
- Common arbitraries: `fc.integer({ min: 0, max: 2 ** 32 - 1 })` for seeds,
  `fc.array(fc.nat(), { maxLength: 40 })` for action choices, `fc.string()` for free text (add
  `fc.string({ unit: 'grapheme' })` where emoji and combining marks matter), and dates as civil day keys
  from integers, never `new Date()`.
- `{ numRuns: 200 }` for the invariant property (the default is 100).
- A failure prints `{ seed, path }`; replay with `fc.assert(property, { seed, path, endOnFailure: true })`
  while debugging, then turn the shrunk input into an example test.
- Fixed seeds (`{ seed: 42 }`) suit infrastructure tests whose inputs must be stable; domain properties
  run unseeded so each run explores new inputs. They are never flaky: a new failure is a real
  counterexample.
- Keep helpers (invariant checks, state builders) outside the `it` callbacks so files stay within
  `max-nested-callbacks` 4; `make<Thing>(overrides)` builders beat 40-line literals. Define them at
  module scope, but call the unit under test only inside `it()`: a module-level
  `const STATE = reduceTaskList(...)` runs at import, and Stryker then ignores every mutant of the
  reducer as static (`coverage-and-mutation.md`).

## playActions: properties for any reducer, policy or rules engine

`test/play-actions.ts` (template, with its own test) turns a list of integers into a legal action
sequence for any pure model: `choice % legalActions.length` picks the next action, and a state with no
legal action ends the play. fast-check then explores action orders without knowing the domain:

```ts
const MODEL = { listActions: legalActions, apply: reduceTaskList };
it('replays identically for the same choices', () => {
  fc.assert(
    fc.property(fc.array(fc.nat(), { maxLength: 40 }), (choices) => {
      const first = playActions(MODEL, INITIAL_TASK_LIST, choices);
      expect(playActions(MODEL, INITIAL_TASK_LIST, choices)).toStrictEqual(first);
    }),
  );
});
```

`listActions(state)` returns the actions that are legal in that state (complete a task that exists,
add one under the limit); `apply` is the reducer. A rules engine whose `applyMove` returns
`{ state, events }` adapts in one line: `apply: (state, move) => applyMove(state, move).state`.
`examples/task-list-reducer.test.ts` is the complete example: examples, an invalid action,
determinism, invariants after any sequence, a JSON round trip and a pinned state.

## The property checklist

- **Determinism**: the same start and actions give the same states (and events).
- **Invariants after any legal sequence**: counts agree with the items, ids stay unique, totals never
  go negative, a limit is never passed.
- **Round trip**: the state survives `JSON.parse(JSON.stringify(state))` unchanged (it is persisted as
  JSON), and a codec's `decode(encode(x))` equals `x`.
- **Migrations**: every valid record of an older schema migrates to a valid current record
  (persistence-and-migrations owns the migration tests).
- **Idempotence** where the spec promises it: completing a task twice equals completing it once.
- **Games plugin**: solver soundness (a level declared winnable has a winning line that replays
  through the rules engine, never trusted as given; level-generation-and-solvers).

## When fast-check finds a counterexample

1. Copy the shrunk input from the failure into a new example test with a title that states the rule.
2. Run it and see it fail on an assertion.
3. Fix the code; both the example and the property turn green.

Never widen the arbitrary or lower `numRuns` to make the failure go away.

## Pinned values and independent oracles

A pinned value is computed once by an independent oracle (a second implementation in another style or
language, a published reference vector) and written into the test; the code under test never produces
its own expected value. The seeded generator, civil-date keys and daily seeds belong to
seeded-determinism-and-golden-vectors, which keeps their pinned sequences and documents each oracle;
extend those tests rather than writing a second one.

Put the `noUncheckedIndexedAccess` guard for "index out of range" in one tested helper
(`pickAt(list, index)`) instead of repeating an unreachable `if (x === undefined) throw` in every
module: unreachable branches otherwise cap branch coverage below 90%.

## Simulations (only with jest.sim.config.js)

Some apps run long simulations: many seeded sessions of a pure model to check a distribution, a
difficulty curve or that nothing loops forever (the games plugin's bots, game-balance-and-bots). They
assert properties of many runs, not single outcomes, live in `test/sims/<area>/<name>.sim.test.ts` or
next to the model as `*.sim.test.ts`, and run only through `jest.sim.config.js` (`npm run test:sim`,
part of `verify`, never pre-commit) in plain Node, which also proves the model needs no React Native
mock. Keep one file under about 60 s.

## Storage and migration tests on node:sqlite

The app's real SQL is tested on Node's built-in `node:sqlite` through the `SqlDriver` port
(persistence-and-migrations owns the test driver, the migrations and the frozen fixtures). Those tests
sit under `test/` because they import `node:sqlite`; they run in the `unit` project and count toward the
coverage of the `src/data/` files they exercise. `node:sqlite` rows have a null prototype, so the
driver copies them before `toStrictEqual`. This skill only fixes where and how they run.
