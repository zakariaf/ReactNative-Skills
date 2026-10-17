# Data goldens, the daily contract and level quality

How levels are pinned so a code change can never silently give players different boards, what the
daily-level contract requires, and what the level quality checks measure.

## Contents

- Why goldens
- The golden test file
- Creating and changing goldens
- The daily level contract
- The levels contract test
- Level quality metrics
- Bots and balance (hand-off)

## Why goldens

Properties prove that levels are solvable and deterministic, not that they are the same levels as
yesterday. A small change in `create`, the RNG use or the curve regenerates different boards under the
same level numbers; a player halfway through pack 2 would find a different level 37. Data goldens pin
readable pictures of chosen levels, so any such change shows up in review as a text diff.

## The golden test file

`src/games/<game-id>/levels/<game-id>-levels.golden.test.ts` (template provided) runs in Jest's
`golden` project (every `*.golden.test.ts`, golden-and-snapshot-tests) and pins:

- the start board of the first and last level of each pack (levels 1, 30, 31, 60, 61, 90 for 3 x 30),
  with the star rule;
- the daily board for three fixed dates, one pair across a year boundary (`'2026-12-31'`,
  `'2027-01-01'`), inside `describe('[contract] <game-id> daily goldens', ...)`.

The golden test knows nothing about the game's state: it adds the seed and the difficulty and asks the
game's own `describeLevel(state)` (`<game-id>-describe.ts`, with a small test) for the rest:

```ts
function describeStart(seed: number, difficulty: number): string {
  const head = `seed ${String(seed)} difficulty ${String(difficulty)}`;
  return `${head} ${describeLevel(create(seed, difficulty))}`;
}
```

The template's `describeLevel` suits a grid game: the move limit, then
`renderCells(state.cells, state.cols)` (`src/core/game/testing/render-cells.ts`: `#` lit or filled, `.`
empty, one line per row). A game with more than a grid renders every part a player sees at the start,
the same way each time. Pig (`examples/pig-levels/levels/pig-describe.ts`) prints its budgets and the
first rolls its stream holds:

```
seed 1956431190 difficulty 0 target 40 turns 10 busts 3
rolls 4,3,2,6,6,1,5,1
{"kind":"score","thresholds":[40,103,123]}
```

The snapshot is written next to the test as `<test file>.snap.ios` (the canonical Jest config's golden
project runs under jest-expo's iOS preset; a project on plain `jest-expo` gets `.snap`, and the checker
accepts `.snap.ios`, `.snap.android`, `.snap` and `__snapshots__/`). The template ships the template
game's snapshot; for any other game, delete it and write your own with `-u`.

## Creating and changing goldens

- `jest --ci` never writes a snapshot: a missing snapshot fails the run, which is what keeps goldens
  deliberate.
- Create or change them only on purpose, one file at a time:
  `npx jest src/games/<game-id>/levels/<game-id>-levels.golden.test.ts --selectProjects golden -u`.
  Never `-u` in scripts, hooks or for a whole folder (run-goldens-rebaseline is the runbook).
- Open the `.snap.ios` file and read the boards before committing: do they look like levels of that
  difficulty?
- Commit with a `Gate-Change: <reason>` trailer (snapshot files are gated paths).

## The daily level contract

- Every device, every app version, same date: same daily level. So the pieces that decide it never
  change for a shipped game: `dailySeed` (its goldens belong to seeded-determinism-and-golden-vectors,
  whose checker runs them), the game's salt, the daily difficulty, and what `create` makes of that seed
  and difficulty.
- The daily goldens for existing dates never change. Their describe title carries the contract marker
  (`[contract]`, or a marker listed in `contracts/goldens.json` `contractMarkers`), and the test is
  registered in `contracts/goldens.json` `contracts` (golden-and-snapshot-tests refuses a changed
  `[contract]` entry and fails an unregistered one). If a rules change would change them, stop and ask
  the developer; the usual answer is to keep the old generation path for the daily difficulty.
- Test the daily with `dailyStart(<GAME>_LEVELS, date)` (seed and difficulty from the `LevelsSpec`, so
  the golden also pins the daily wiring the game screen uses) and pin the boards in a
  `*.golden.test.ts` file. `dailySeed(date, salt)` with the salt constant is accepted too. For a game
  whose daily mode is on, `check-levels.mjs` finds the golden file that calls `dailyStart(` or
  `dailySeed(` and requires at least three quoted `YYYY-MM-DD` dates with a `YYYY-12-31` / next
  `YYYY-01-01` pair in it (`daily-golden`), and the marker (`daily-golden-contract`). The rule reads
  the source text: dates built at run time (a loop, `new Date`) are not seen, so write them as literals.

## The levels contract test

`src/games/<game-id>/levels/<game-id>-levels.test.ts` calls `levelsContractProblems`
(`level-kit/levels-contract.ts`) and expects `[]`:

| Check | Message |
|---|---|
| table numbered 1..n in order | `table[4] is level 6, expected 5` |
| every difficulty equals `difficultyFor(level)` | `level 3 difficulty 9 differs from difficultyFor (3)` |
| no repeated seed and difficulty | `level 2 repeats seed/difficulty 1/1` |
| pack ids kebab-case, consecutive, sizes equal to the config | `pack second starts at 4, expected 3` |
| first pack needs 0 stars, later packs never fewer than earlier ones | `the first pack must need 0 stars` |
| pack count and levels per pack match the config (`contracts/levels.json`) | `2 packs, the config says 3` |
| every level and the daily at or below 99; an endless mode exactly at `ENDLESS_DIFFICULTY` (100) | `the endless difficulty 99 is not ENDLESS_DIFFICULTY (100)` |
| with a solver: every level solved (a witness re-played from its fixed bot seed), its line replays through the real engine and wins, and a par level's par equals the recorded par | `level 4 par 3 differs from the solver's 4`, `level 7 is budget-exceeded` |

This is "every shipped level is proven winnable" as a test that runs on every commit. The test's
`CONFIG` literal repeats the contract entry, because app code cannot import files outside `src/`; the
checker compares the packs with the contract itself.

## Level quality metrics

`node ${CLAUDE_SKILL_DIR}/scripts/check-levels.mjs . --game <game-id> --report` prints per pack: level
count, difficulty range and average, par range and average. Every rule it enforces, with options and
expected SKIP and NOT APPLICABLE lines, is in `checker.md`; the quality rules are:

| Rule | Fails when |
|---|---|
| `difficulty-curve` | a level's difficulty is below the level before it |
| `trivial-level` | a level after level 3 is won in one move |
| `par-curve` | a later pack averages a lower par than an earlier pack |
| `duplicate-level` | two levels share seed and difficulty |
| `pack-size` / `pack-config` | packs differ in size, or from the contract (count, size, star rule) |

The bands (minimum par per pack, difficulty cap) are approved by the developer in the game's design
notes; the plan's `rate()` enforces them while generating.

## Bots and balance (hand-off)

Difficulty in terms of bot win rates, the endless run's length and "no endless games" are measured by
bot simulations (`*.sim.test.ts`, `npm run test:sim`) with game-balance-and-bots, before the packs are
generated. Winnability of each shipped level is proven here: by the exact solver for par games, by the
witness (the game's reasonable player from a fixed seed) for games that draw at random. Keep the solver
or the witness for proofs and the sims for how a human-like player fares.
