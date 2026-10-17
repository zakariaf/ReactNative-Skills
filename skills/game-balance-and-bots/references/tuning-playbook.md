# Tuning playbook: knobs, curves and the tuning loop

How to change a game's difficulty on purpose, one number at a time, with the sims as the measuring
tape.

## Contents

- The tuning file
- Which knobs exist in most games
- The difficulty curve
- The tuning loop
- Symptoms and what to turn
- Worked example: tuning Pig
- Daily, packs and levels

## The tuning file

Every balance number of a game lives in `src/games/<game-id>/rules/<game-id>-tuning.ts` (a real-time
game keeps it in `sim/<game-id>-tuning.ts` with the file-level `'worklet';` directive, because its sim
reads it on the UI thread). game-rules-engine's template game ships the file; this skill carries a
synced copy (`templates/src/games/__GAME_ID__/rules/__GAME_ID__-tuning.ts`, with its test) only so its own
templates compile alone, and the rules it states here are the ones the checker enforces.

The template is Lights Out's: one per-row knob, the board `side` in three rows (0-33: 3x3, 34-66: 4x4,
67-99: 5x5), and scalar knobs for the scramble presses (`minPresses`, one more every
`difficultyPerPress` points, through `pressesFor`), the moves per press, the points per spare move and
the continue's extra moves. It has no endless mode. A game with one has the shape of Pig's file
(`examples/pig/src/games/pig/rules/pig-tuning.ts`):

```ts
import { isEndlessDifficulty, rowFor } from '@/core/game/difficulty';

export type PigKnobs = {
  /** Points to bank to win (higher = harder; 0: the endless run, no target, never won). */
  readonly target: number;
  /** Turns a run may use; a hold or a bust ends a turn (fewer = harder). */
  readonly maxTurns: number;
};

/** Level rows, easiest first: a higher target with relatively fewer turns needs riskier turns. */
const LEVEL_ROWS = [
  { target: 40, maxTurns: 7 },
  { target: 60, maxTurns: 9 },
  { target: 80, maxTurns: 10 },
  { target: 100, maxTurns: 11 },
] as const satisfies readonly PigKnobs[];

/** The endless run: bank as much as you can before the turns or your luck run out. */
const ENDLESS_ROW: PigKnobs = { target: 0, maxTurns: 20 };

export const TUNING = {
  /** Busts in a row that end the run (fewer = harsher on pushing your luck). */
  maxBusts: 5,
  // ... every knob that does not change with difficulty, each with a comment
  levelRows: LEVEL_ROWS,
  endlessRow: ENDLESS_ROW,
} as const;

/** The knobs of a difficulty 0..100: the endless row at 100, else the level row rowFor picks. */
export function knobsFor(difficulty: number): PigKnobs {
  if (isEndlessDifficulty(difficulty)) return TUNING.endlessRow;
  const row = rowFor(difficulty, TUNING.levelRows.length);
  // A reduce over the non-empty table: no unreachable `?? table[0]` branch for the coverage gate.
  return TUNING.levelRows.reduce((picked, knobs, index) => (index === row ? knobs : picked));
}
```

Rules:

- The rules read knobs only through `TUNING` and `knobsFor(state.difficulty)`; they contain no other
  balance numbers (a `3` hearts in `create.ts` is a hidden knob). Board geometry, damage, spawn rates,
  goals, turn budgets, starting resources and opening layouts are all knobs.
- A table beats a formula: four explicit rows are easy to read, diff and tune one cell at a time. Use
  a formula only when a game has dozens of levels, and keep its coefficients in the tuning file.
- Every knob has a comment saying what it controls and which direction is harder (`check-balance.mjs`
  fails an undocumented knob). Document each per-difficulty knob once, on the knobs type: the rows of
  the table are values, so Prettier may wrap a long row over several lines without a comment on each
  (fixture `pass-wrapped-table`).
- **Difficulty is one scale, whole numbers 0..100** (`src/core/game/difficulty.ts`), never a table
  index. `create(seed, difficulty)` stores the clamped value; `knobsFor` maps it to a row with
  `rowFor(difficulty, rows)`, so the level curve (0..99), a daily challenge and every tuning row line
  up, and a saved run stays valid when a row's numbers change. 100 (`ENDLESS_DIFFICULTY`) is the
  endless run of a game that has one: its own row with no goal, never won.
- Pick the row with `rowFor` and a `reduce` over the table, as above. A real-time game's `'worklet'`
  tuning module may call only worklets on the UI thread, so it writes `rowFor`'s one line out instead
  of importing it (`examples/arena-chase/src/games/arena-chase/sim/arena-chase-tuning.ts`).
  `table[index] ?? table[0]` has a branch no test can reach, and the copied file then fails the 90 %
  per-file branch threshold of `src/games/*/rules/`.
- Test the mapping (`<game-id>-tuning.test.ts`): the lower and upper bound of each band, clamping
  below 0 and above 100, and the endless row at 100 when the game has one.

## Which knobs exist in most games

| Knob family | Examples | Harder when |
|---|---|---|
| Goal | points, targets, pieces to clear, par | higher |
| Budget | moves, turns, seconds in a round | lower |
| Pressure frequency | enemies step every N moves, spawn every N, a flood rises every N | lower N |
| Pressure strength | enemy health, enemy count, damage, chaser speed | higher |
| Resources | hearts, undos, hand size, tray size | fewer |
| Risk | busts allowed in a row, penalty of a failed gamble | harsher |
| Board density | opening blocks, rocks, walls, free cells | usually more (and more lock-prone) |
| Randomness mercy | how often the helpful piece or card is dealt | rarer |

Turn goals, budgets and pressure frequency first: they move the curve predictably. Strength knobs move
it in jumps. Density and risk knobs change how runs end, so watch `lossReasons` when you touch them.

## The difficulty curve

- Monotone: each difficulty is clearly harder for the reasonable player (its win rate drops by at
  least `minStep`, 0.1 by default). Two levels that feel the same waste the player's time; a cliff
  (0.58 → 0.08) ends most players' progress.
- The easiest level is winnable by a reasonable player most of the time (60-90 %), rarely always: a
  level that cannot be lost teaches little (a warm-up row of a short puzzle is the exception).
- The hardest level is hard but winnable (8-50 % for the reasonable player), and the lookahead bot
  still wins it often: the ceiling is skill, not luck.
- A daily challenge, when the app has one, uses a medium difficulty (the middle rows, about 40-50), so
  it is fair on most days.
- The sims sample the lower bound of each row for the curve (`[0, 25, 50, 75]` for four rows). The
  endless difficulty 100 is never a step of the curve: it has its own `endless` block in the bands
  file (balance-contract.md, "Endless mode").

## The tuning loop

1. Run `npm run test:sim` and read the report (`reports/sim/<game-id>.json`): win rates per policy and
   difficulty, move spread, `lossReasons`, the first-payoff curve, twists per run.
2. Name the problem in one sentence ("every reasonable run of row 2 dies at move 10": look at
   `p10Moves` and `p90Moves` together).
3. Form one hypothesis and change one knob (or one column of the table) in the tuning file.
4. Rerun and compare the two reports (same seeds, so the difference is the change).
5. Keep or revert. A kept knob change runs the unit tests too (`npm test`): rules tests read knobs
   from `TUNING` and `knobsFor`, never as literals (game-rules-engine's testing rules), so they
   follow the change; a test that pinned a knob as a literal is rewritten to read it, in the same
   commit. Repeat until the curve, the gap, the kill test and the twist hold.
6. Write the bands around the result and the story in the bands file's `notes`.

Change the bot's evaluation only to fix unreasonable play (it filled the board a person would keep
open), never to reach a band. Never change seeds to find "better" numbers.

## Symptoms and what to turn

| Symptom in the report | Likely cause | Turn |
|---|---|---|
| `p10Moves == p90Moves`, low: every run dies at the same move | Pressure arrives on a fixed clock faster than the player can answer | pressure frequency down, budget up |
| Win rate near 0 for every policy | Too hard or a broken win condition | goal down, pressure down; check that `won` is reachable in a unit test |
| Win rate near 1 for random | Choices do not matter, or the budget is generous | goal up, budget down; make wrong moves cost something |
| random beats the reasonable player | The rules punish the sensible choice (Pig: a bust streak ends the run) | the risk knob that punishes it; read `lossReasons` |
| reasonable ≈ lookahead | No depth to master | add a reason to plan ahead (delayed payoffs, combos) |
| random ≈ reasonable | The evaluation or the choices are fake | check evaluate; strengthen the consequences of moves |
| One `lossReasons` key dominates the easy levels | The game ends by attrition, not by the intended threat | density or risk down, more clears |
| `capHits > 0` | A run can go on forever or gets stuck | fix the rules: every game must end (pressure, a budget or a stuck detector) |
| First payoff late (`firstPayoffShare[2]` low) | The opening does not set up an early win moment | build the opening for it (fun-and-kill-test.md) |
| `twistPerRun` < 1 | The twist rarely matters | change the rules so the twist is the natural best move, not a curiosity |
| Curve not monotone or too flat | Two rows too close, or a knob that helps in disguise | spread the rows; change one column of the table |

## Worked example: tuning Pig

Pig is the public-domain dice game, played solo against a target and a turn budget: roll as often as
you dare, a 1 busts the turn and loses its points, hold to bank them; too many busts in a row end the
run. game-rules-engine's `examples/pig` holds the rules; this skill's `examples/pig/` holds the bot
hooks, the sim, the bands, the tuned tuning file and the real report. The reasonable player holds at
20 or as soon as the target is reached (it never peeks at the next roll, bots-and-sims.md); the
lookahead bot sees the next rolls. Four rows sampled at 0/25/50/75, 100 seeds per cell.

**First run** (the rules example's tuning: `maxBusts` 3, turns per row 10/12/14/16):

| | d0 | d25 | d50 | d75 |
|---|---|---|---|---|
| holdAt20 win rate | 0.61 | 0.47 | 0.34 | 0.28 |
| random win rate | 0.72 | 0.50 | 0.24 | 0.12 |
| lookahead win rate | | 0.91 | | |

Random play beat the reasonable player on the easiest row. `lossReasons` explained it: 39 of 100
holdAt20 runs at d0 ended in `pig.lose.bust-streak`. A player who pushes to 20 busts often, and three
busts in a row ended the run, while random play holds early and rarely busts. The rules punished the
sensible choice.

**Change 1:** the risk knob, `maxBusts` 3 → 5.

| | d0 | d25 | d50 | d75 |
|---|---|---|---|---|
| holdAt20 win rate | 0.88 | 0.83 | 0.76 | 0.67 |
| random win rate | 0.76 | 0.54 | 0.25 | 0.12 |

The skill gap came back (random 0.54 < holdAt20 0.83 < lookahead 0.96 at d25), but random still won
three of four easiest levels (the turn budget was generous) and the curve fell by only 0.05-0.09 per
row.

**Change 2:** the budget column, turns per row 10/12/14/16 → 7/9/10/11.

| | d0 | d25 | d50 | d75 | endless (d100) |
|---|---|---|---|---|---|
| holdAt20 win rate | 0.84 | 0.74 | 0.63 | 0.46 | 0 (never won) |
| random win rate | 0.41 | 0.16 | 0.04 | 0 | |
| lookahead win rate | | 0.90 | | | |
| holdAt20 median rolls | 18 | 26 | 33 | 39 | 70 |
| holdAt20 busts that lose points (twist) per run | 1.91 | 2.83 | 3.61 | 4.17 | 7.01 |

The curve drops by 0.10, 0.11 and 0.17 per row, random loses most levels, the lookahead bot shows
there is still skill to gain, and busts stay a real risk. The endless run lasts a median 70 rolls and
ends half by a bust streak and half by the turn budget. The bands in
`examples/pig/test/sims/pig/balance-bands.json` are written around these numbers (curve step 0.08,
skill-gap step 0.1, below the measured steps), `status: "proposed"` until a person plays it.

**A rejected budget:** 8/9/10/11 turns left random winning 0.56 of the easiest levels: naive play
should mostly lose, so the first row kept 7 turns.

**The payoff decision (decided before the first sim run):** Pig's moment of play is the roll that
survives: every "one more roll" is the push-your-luck question, and a surviving roll is its "yes".
So the payoff tag is a surviving roll and the twist a bust that throws the turn's points away, chosen
on design grounds and written in the bands' `notes` before any sim ran. Banking is the goal the score
measures (`medianScore`), not a tag. A later observation agrees with that split: had a bank been the
payoff, it would have come within 10 rolls in only 65 % of reasonable runs (a first-turn bust is
common). That number explains why banks are measured by the score; it was never a reason to rename
the payoff, which would be the anti-pattern of tuning the test to the result.

## Daily, packs and levels

- Levels are generated from a seed plus a difficulty; the level table maps level numbers to
  difficulties 0..99, `knobsFor` maps each difficulty to its row, and a daily uses a medium
  difficulty. The sims measure the difficulty rows; the level generator and solver (proving each
  shipped level winnable, par, stars) belong to level-generation-and-solvers.
- A pack's difficulty curve over its levels is a sequence of rows: use the sims to make sure
  neighbouring rows differ, then let the generator pick seeds per level.
- Tune before the level tables exist: the balance sims pass first, then the tables are generated.
  Changing a row later changes every level and daily built from it: regenerate the tables in the same
  commit with a `Gate-Change:` trailer explaining the change (git-commits-and-reporting). Daily
  goldens are a compatibility contract: a tuning change that alters an existing date's daily is a
  question for the developer first.
