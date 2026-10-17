# Testing a rules engine

How the rules are proven: the test-first loop, what every rules module is tested with, the property
checklist, the pinned golden, the two contract tests, and the numbers the gates require.
unit-and-component-tests owns the Jest projects, fast-check and the coverage and mutation tables;
tdd-workflow owns the red-green loop.

## Contents

- The loop
- Files and names
- Example tests
- Property tests with fast-check
- The property checklist
- The pinned golden value
- The engine contract test and the module contract test
- Coverage and mutation gates
- Commands
- Traps

## The loop

1. Pick the next behaviour and quote its requirement in the test title or a comment.
2. Write one failing test: `npx jest src/games/<game-id>/rules/<file>.test.ts --ci --selectProjects unit`.
3. Read the failure. The right reason is an assertion diff (`Expected ... Received ...`); an import,
   type or syntax error is the wrong reason: fix the test first.
4. Write the minimum code, run again: green.
5. Refactor by responsibility (size limits); the tests stay green.
6. Run the fast gates, then commit test and code together (git-commits-and-reporting).

Never edit an existing assertion to make it pass unless the requirement changed (then say so in the
commit), and never add `.skip`, `.only` or an inline `eslint-disable` (the canonical config ignores it).

## Files and names

- Tests sit next to the unit: `create.test.ts`, `apply-move.test.ts`, `outcome.test.ts`,
  `<game-id>-engine.test.ts`, `<game-id>-persistence.test.ts`, `<game-id>-stats.test.ts`,
  `testing/<game-id>-testing.test.ts`, and `<game-id>-game.test.ts` beside the module.
- `describe('<exported name>')`, optional `describe('when ...')`, then `it('<third-person verb> ...')`:
  the canonical lint requires titles matching `^(can|[a-z]+s)\b` ("toggles the tapped cell", "throws
  for a cell outside the grid", "reports no win in the endless run"; not "should toggle" or "never wins").
- A helper used inside property callbacks sits outside the `it` (`expectInvariants(states)` in the
  templates), so callbacks stay within 4 nesting levels.

## Example tests

One behaviour per `it`, with hand-built states: a 3x3 board with exactly these cells lit
(`board([8])`), Pig's seed 1 whose fourth roll is a 1 (`play(create(1, 0), [ROLL, ROLL, ROLL])`
then a bust). Assert with `toStrictEqual` on the whole result (state and events), and test every thrown
error with `toThrow(RangeError)`.

Expectations that depend on a balance number read it from the tuning file (`TUNING`, `knobsFor`),
never as a literal: `turn: knobsFor(0).maxTurns`, `busts: TUNING.maxBusts`. A balance pass
(game-balance-and-bots) then changes the numbers without breaking a test. The pinned `GOLDEN_*` value
is the one deliberate exception: it pins the whole generated state on purpose.

## Property tests with fast-check

`playChoices(rules, start, choices)` (`src/core/game/testing/play-choices.ts`) turns a list of integers
into a legal move sequence for any engine (`choice % legalMoves.length` picks the move), so fast-check
explores move sequences without knowing the game:

```ts
const seedArb = fc.integer({ min: 0, max: 4_294_967_295 });
const choicesArb = fc.array(fc.nat(), { maxLength: 40 });

it('replays identically for the same seed, difficulty and move choices', () => {
  fc.assert(
    fc.property(seedArb, difficultyArb, choicesArb, (seed, difficulty, choices) => {
      const first = playChoices(RULES, create(seed, difficulty), choices);
      expect(playChoices(RULES, create(seed, difficulty), choices)).toStrictEqual(first);
    }),
  );
});
```

When fast-check finds a counterexample, copy the printed input into an example test first, see it
fail, then fix the code. Reproduce with the printed `{ seed, path }`. Map `fc.record` values through
`({ ...value })` before comparing a transformed copy: fast-check can build null-prototype objects,
which `toStrictEqual` tells apart from plain ones.

## The property checklist

| Property | Shape |
|---|---|
| Determinism | same seed, difficulty and choices give deep-equal states and events |
| Invariants after any legal sequence | one move per `applyMove`, never past the move or turn limit, banked points never fall |
| Start in play | `outcome(create(seed, d)).kind === 'playing'` for any seed and difficulty 0..100 |
| End state | `listMoves(state).length === 0` exactly when `outcome(state).kind !== 'playing'`, for every visited state |
| Save round trip | `JSON.parse(JSON.stringify(state))` deep-equals the state after random play (the stream included); `parseState` returns it unchanged |
| Game-specific algebra | a toggle applied twice is the identity; a merge conserves the total; a roll always shows 1..6 |

Undo properties (undoing k moves equals the state k moves earlier) and replaying a saved log are the
session host's tests (game-session-host).

## The pinned golden value

Properties alone let real bugs survive (in mutation probes, determinism and range properties left 3 of
8 RNG mutants alive). So every rules folder pins at least one exact value next to its properties, in a
constant named `GOLDEN_*` at the bottom of the test file:

```ts
it('keeps the pinned board for seed 1 at difficulty 0 (a changed board breaks shipped levels)', () => {
  const state = create(1, 0);
  expect(boardText(state.cells, state.cols)).toBe(GOLDEN_SEED_1_BOARD);
});

const GOLDEN_SEED_1_BOARD = ['###', '###', '..#'].join('\n');
```

A golden changes only on purpose, with a `Gate-Change:` commit trailer that says why
(git-commits-and-reporting). The RNG's own goldens in `src/core/rng/sfc32.test.ts` never change.

## The engine contract test and the module contract test

`rules/<game-id>-engine.test.ts` runs `engineContractProblems` (`src/core/game/testing/engine-contract.ts`)
over several seeds and difficulty bands, with no input:

```ts
const problems = engineContractProblems({
  gameId: 'lights-out',
  engine: LIGHTS_OUT_ENGINE,
  persistence: LIGHTS_OUT_PERSISTENCE,
  starts: [0, 25, 50, 100].flatMap((difficulty) => [1, 2, 3].map((seed) => ({ seed, difficulty }))),
  maxMoves: 60,
  // A game with an endless mode adds: endless: { kind: 'endless', difficulty: ENDLESS_DIFFICULTY }
});
expect(problems).toStrictEqual([]);
```

It plays seeded random games and reports: `create` not deterministic or starting finished, a state or
move that JSON cannot carry (`jsonShapeProblems` names the path: "state.banked is NaN"), parsers that
do not return saved values unchanged, `applyMove` changing its input, events without kebab-case kinds,
`listMoves` not empty exactly at the end, lose reasons outside the game's namespace, fractional win
scores, replays that differ and, with `endless`, a run from the endless difficulty that ends `won`.

`<game-id>-game.test.ts` (beside the module) adds `input: MODULE.input` and `intents: everyIntent`
(`examples/lights-out-module/lights-out-game.test.ts`). Taps are built with `selected: null`; a game
with `selectRegions` also lists taps on those regions, and every other tap is retried with each of
them as the selection. It then also reports: `intentToMove` returning a move `listMoves` does not list,
a `panMode` outside the four, `selectRegions` that is not a list, a tap inside a select region that
makes a move, and an accepted intent the pan mode never sends.

`check-rules-engine.mjs` runs the same kind of seeded check on the four rules modules directly (and
with the game's bot once the testing file exists), so it works before either test is written.

## Coverage and mutation gates

- The canonical Jest config sets 95/95/95/90 (statements, lines, functions, branches) for
  `src/core/` and `src/games/*/rules/**` (global 90/90/90/85); `testing/` folders are left out of
  coverage. Cover the unreachable-looking branches with example tests (a corrupted save for
  `parseState`, the version-1 `migrateState`).
- When a rules module is finished, run Stryker on it (`npx stryker run --mutate
  src/games/<game-id>/rules/apply-move.ts`); the canonical break threshold is 75 %. Kill surviving
  mutants with boundary examples (exactly at the move limit, the last cell of a row), never by
  lowering a threshold. unit-and-component-tests' `check-mutation-report.mjs` reads the report.

## Commands

| Need | Command |
|---|---|
| One file | `npx jest src/games/<game-id>/rules/apply-move.test.ts --ci --selectProjects unit` |
| One title | `npx jest src/games/<game-id>/rules --ci -t 'toggles the tapped cell' --selectProjects unit` |
| The game with coverage | `npx jest src/games/<game-id> --ci --selectProjects unit --coverage --collectCoverageFrom='src/games/<game-id>/rules/**/*.ts' --coverageThreshold='{}'` |
| The thresholds (the whole repo) | `npm run test:coverage` |
| Types | `npm run typecheck` (both programs) |
| Lint and format | `npx eslint --max-warnings 0 src/games/<game-id> src/core/game` and `npx prettier --check src/games/<game-id>` |
| The skill's check | `node ${CLAUDE_SKILL_DIR}/scripts/check-rules-engine.mjs . --game <game-id>` |

## Traps

- **A subset run with `--coverage` fails the global threshold.** Without `--coverageThreshold='{}'`
  Jest judges the root config's numbers against a run that loaded a few files and exits 1 even when
  every file passes. Subset runs print the table with `--coverageThreshold='{}'`; only
  `npm run test:coverage` judges the thresholds.
- **`--selectProjects` takes several values.** `npx jest --selectProjects unit src/games/x` reads
  `src/games/x` as a second project name and runs the whole unit suite. Put the paths first and
  `--selectProjects unit` last.
- **Tests that read the clock or `Math.random`** are banned like the rules themselves; build states by
  hand or from seeds.
- **Snapshots of large objects** are not goldens: pin a small readable text (`'###\n..#'`) or a short
  list in a `GOLDEN_*` constant.
- **`toEqual` hides `undefined` keys**; use `toStrictEqual` (the lint rule enforces it), which is also
  what the JSON round trip needs.
