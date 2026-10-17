# Bots and simulations

How a game is played thousands of times headless, and how those runs become numbers. Every code file
named here is in this skill's `templates/` folder at the path it takes in the app (line 1 names it);
the worked examples are `examples/pig/` (turn-based, draws during play, an endless run) and
`examples/arena-chase/` (real-time).

## Contents

- The harness at a glance
- What a bot needs from a game
- The three standard players
- Games that draw during play: the reasonable player never peeks
- Writing the game's bot hooks
- Payoff and twist tags
- The sim file
- Real-time and simulate-then-replay games
- Determinism, iOS and Android
- Speed
- Debugging a surprising number
- Reporting the numbers
- When multi-package

## The harness at a glance

| File (app repo) | What it does |
|---|---|
| `src/core/game/testing/play-bot.ts` | `BotPolicy`, `BotGame`, `randomPolicy()`, `playBot()`: the minimal loop. game-rules-engine owns it (the testing spec's `bot` is a `BotPolicy`); this skill carries a copy only so its templates compile alone |
| `src/core/game-balance/trace-bot.ts` | `traceBot()`: the same loop as `playBot`, plus what the report needs (final score, payoff and twist tags, capped runs) |
| `src/core/game-balance/bot-policies.ts` | `greedyPolicy(rules, evaluate)` and `lookaheadPolicy(rules, evaluate, { depth, beam })` |
| `src/core/game-balance/sim-stats.ts` | `summarizeCell()`: many traces → one report cell (win rate, move spread, loss reasons, first-payoff curve) |
| `src/core/game-balance/balance-bands.ts` | `SimReport`, `BalanceBands`, `bandProblems(report, bands)` |
| `src/core/game-balance/parse-balance-bands.ts` | `parseBands(json)`: validates `balance-bands.json` and returns it typed |
| `src/core/game-balance/run-sim-bot.ts` | `runSimBot()`: the same trace for a real-time sim driven by integer commands |
| `test/sims/write-sim-report.ts` | `rulesFingerprint(gameId)` (the game's logic folders without the generated `levels/pack-*.json`, the sim and the `src/core` files they import: `fingerprintFiles(gameId)`) and `writeSimReport(report)`; Node APIs, so it lives in the root `test/` folder, with its test |
| `jest.sim.config.js` (repo root) | Plain-Node Jest config for `*.sim.test.ts` (canonical, unit-and-component-tests owns it); `npm run test:sim` runs it |
| `test/sims/<game-id>/balance.sim.test.ts` | One game's sim: plays the grid, writes `reports/sim/<game-id>.json`, asserts the bands |
| `test/sims/<game-id>/balance-bands.json` | The game's balance contract (balance-contract.md) |
| `src/games/<game-id>/testing/<game-id>-bot.ts` | The game's bot hooks: `evaluate<Game>`, `scoreOf<Game>`, `tag<Game>Event`, the reasonable player |
| `src/games/<game-id>/rules/<game-id>-evaluate.ts` | The evaluation, when a level witness (`levels/`) also plays with it: `levels/` may import only the core and the game's `rules/` and `levels/` |

Every harness file is pure TypeScript under the determinism policy (no clock, no `Math.random`,
only exact `Math` functions), except the writer, which uses `node:fs` and `node:crypto`. The harness
files have colocated unit tests that run in `npm test` (they meet the `src/core` coverage gate,
95/95/95/90); only `*.sim.test.ts` files wait for `npm run test:sim`.

`jest.sim.config.js` (copied from `templates/`, identical to the canonical file):

```js
module.exports = {
  rootDir: __dirname,
  displayName: 'sim',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.sim.test.ts', '<rootDir>/test/**/*.sim.test.ts'],
  transform: { '\\.ts$': ['babel-jest', { caller: { name: 'metro', bundler: 'metro', platform: 'ios' } }] },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1', '^@test/(.*)$': '<rootDir>/test/$1' },
  // plus modulePathIgnorePatterns (native folders, installed skills) and testTimeout: 300_000
};
```

The root `package.json` has `"test:sim": "jest --ci --config jest.sim.config.js"`, and the unit
project of `jest.config.js` ignores `\.sim\.test\.`, so sims never run in `npm test` or pre-commit.
`test:sim` runs inside the pre-push verify (quality-gates). The `platform: 'ios'` caller only picks
Babel's platform for the transform; the sim code is platform-free, so the numbers are the same for
the Android build. A sim that needs a React Native mock is a bug: the rules must be pure TypeScript.

## What a bot needs from a game

A bot drives only the four pure engine functions, `BotGame = Pick<GameEngine, 'create' | 'listMoves' | 'applyMove' | 'outcome'>`:

- `create(seed, difficulty)`: the start state. Same seed and difficulty, same state.
- `listMoves(state)`: every legal move; empty exactly when the game is over.
- `applyMove(state, move) → { state, events }`: pure; events say what happened (Lights Out:
  `cells-toggled`, `board-cleared`; Pig: `die-rolled`, `turn-busted`, `turn-banked`).
- `outcome(state)`: `playing`, `won` with a score, or `lost` with a catalog reason key. The reason key
  is what the report's `lossReasons` counts, so every way of losing has its own
  `<game-id>.lose.<reason>` key (Pig: `pig.lose.bust-streak` and `pig.lose.out-of-turns`).

`outcome` and `listMoves` run for every candidate move a searching bot looks at, so keep "is there
any legal move" cheap: an early-exit check instead of listing every move inside `outcome`.

The difficulties a bot plays are the one 0..100 scale: the grid samples level difficulties (0..99,
the lower bound of each tuning row: `[0, 25, 50, 75]` for four rows, `[0, 34, 67]` for three), and a
game with an endless mode is played once more at 100 in its own `endless` block, never inside the
grid (balance-contract.md, "Endless mode").

## The three standard players

| Player | What it is | Answers |
|---|---|---|
| `random` (`randomPolicy()`) | A uniformly random legal move | The baseline: how far can someone get without thinking? Naive play should mostly lose. |
| the reasonable player (`greedyPolicy(rules, evaluate)` by default) | The move whose next state evaluates best (one ply), or a rule a person follows (next section) | The difficulty curve, the kill test and the twist are measured with it. It is also the testing spec's `bot`. |
| `lookahead` (`lookaheadPolicy(rules, evaluate, { depth: 2, beam: 4 })`) | Best value over `depth` plies of its own moves, searching only the `beam` best-looking moves per ply | The upper bound of skill. It sees the seeded future (the next draw, the next spawn), so it plays better than any person can. |

Policy names in the bands file are free text: the template uses `random`, `greedy` and `lookahead`,
Pig `random`, `holdAt20` and `lookahead`, the real-time example `idle`, `wander` and `dodge`.

- **Outcome-aware.** Both searching policies score a won state above any position and a lost state
  below any (`judge`: ±1,000,000 plus the evaluation), so `evaluate` only ranks ongoing positions.
- **Ties** are broken with the bot's own seeded RNG, never "first move wins", so a bot has no
  position bias and still replays exactly. A policy called with no legal move throws instead of
  inventing one.
- **The bot RNG** is seeded with `seed ^ 0x5bd1e995` by `playBot`/`traceBot`, separate from the
  game's RNG inside the state.
- **Depth and beam** trade strength for time: a decision at depth 2, beam 4 costs about the number of
  legal moves plus 4 × that again in `applyMove` calls. If the lookahead cells dominate the sim's run
  time, lower the beam or run lookahead in fewer cells.
- **Skill gap.** `random < reasonable < lookahead` on the skill-gap metric, each by a clear step. If
  random plays as well as the reasonable player, the choices are fake (or the rules punish the
  sensible choice: Pig's first run); if the reasonable player already plays like lookahead, there is
  no depth to master.

## Games that draw during play: the reasonable player never peeks

A game that draws after `create` keeps its stream in the state (game-rules-engine rule 3), so
`applyMove` decides the next draw, and any policy that calls `applyMove` to judge a move sees that
draw before it chooses. `greedyPolicy` does exactly that: in Pig it holds precisely before every
roll that would bust, so it never loses a turn's points (`examples/pig/src/games/pig/testing/pig-bot.test.ts`,
"why greedyPolicy is not the reasonable player here", proves it). That is a cheat, not a person.

So in a game whose moves reveal hidden randomness (dice, card draws, refills, spawns):

- The **reasonable player** is a rule a person could follow from what the screen shows: Pig's
  `pigBot` holds at 20 or as soon as the target is reached. Write it as a plain `BotPolicy` and name
  it after its rule in the grid (`holdAt20`).
- `lookahead` stays: peeking is what makes it the upper bound.
- A game whose randomness happens only inside `create` (Lights Out's scramble) has nothing hidden
  during play, and `greedyPolicy` is a fair reasonable player.

## Writing the game's bot hooks

`src/games/<game-id>/testing/<game-id>-bot.ts` exports four things. The template
(`templates/src/games/__GAME_ID__/testing/__GAME_ID__-bot.ts`, with its test) is the template game's,
Lights Out's: `evaluate` counts lit cells and values a board one press from dark (a lit cross) the way
a person sees it, `scoreOf` is the win's score, the payoff is `board-cleared` and the twist a press
that toggles four or five cells. Plain "fewest lit cells" won only 0.56 of the easiest boards (the
testing spec's starter bot, first move on ties, 0.5) because it walks away from the finishing cross,
which no person does: that is the kind of evaluation fix rule 11 allows.

Pig (`examples/pig/src/games/pig/testing/pig-bot.ts`) shows the other shape:

```ts
/** Banked points count fully, points still at risk half, and every turn left a little. */
export function evaluatePig(state: PigState): number {
  const turnsLeft = Math.max(state.maxTurns - state.turn, 0);
  return state.banked * 2 + state.turnTotal + turnsLeft;
}

/** The report's "score": the banked points the top bar shows. */
export function scoreOfPig(state: PigState): number {
  return state.banked;
}

/** Payoff: a roll that survives. Twist: a bust that throws away points already rolled. */
export function tagPigEvent(event: PigEvent): readonly EventTag[] {
  if (event.kind === 'die-rolled' && event.face !== TUNING.bustFace) return ['payoff'];
  return event.kind === 'turn-busted' && event.lostPoints > 0 ? ['twist'] : [];
}
```

- **Where the evaluation lives.** When only bots use it, `evaluate<Game>` may sit in the bot file.
  When a level witness uses it too (levels proven by the reasonable player,
  level-generation-and-solvers), it lives in `rules/<game-id>-evaluate.ts` and the bot file
  re-exports it: code in `levels/` may import only the core and the game's own `rules/` and
  `levels/`, never `testing/`. Changing that evaluation changes the witness, so the level tables
  are regenerated in the same commit.
- `evaluate` weighs what a sensible player cares about: progress toward the goal first, safety second
  (lives, danger close), then position quality. Name every weight as a constant. Keep it simple: the
  bot plays like a reasonable person, not like a solver.
- Improve `evaluate` only to match reasonable human play, never to push a number into a band. If a
  band fails, change the game (the tuning file), not the player.
- `scoreOf` returns the number the HUD and the result screen show; the report's `medianScore` uses
  it. Counters (pops, defeats, combos) belong to the stats screen, not the score.
- Unit-test the hooks: the tags, that `evaluate` prefers progress and dislikes danger, that the bot
  takes the obvious payoff, and (for a game that draws during play) that the reasonable player draws
  nothing from its own stream.
- The game's testing spec (`testing/<game-id>-testing.ts`, game-rules-engine) sets `bot` to the
  reasonable player, replacing its starter bot, so the host's contract tests, E2E setup and the sims
  all use the same player.

## Payoff and twist tags

`tag<Game>Event(event)` returns the tags an event carries:

- **`payoff`**: the moment the player feels "yes": the board goes dark, a spark is collected, a roll
  survives, a line clears. The kill test measures how soon the first one comes
  (`firstPayoffShare`); `payoffPerRun` counts them.
- **`twist`**: the game's special mechanic actually happening, the thing that makes it more than its
  base game: a pulse that throws chasers back, a bust that takes a turn's points, a press that
  toggles a whole cross. `twistPerRun` counts them.

Most events carry no tag. One event may carry both. Decide the tags before the first run and write
the reason down in the bands' `notes`; renaming a tag after a failing run to make it pass is moving
the band.

## The sim file

`test/sims/<game-id>/balance.sim.test.ts` (from `templates/test/sims/__GAME_ID__/`; replace
`__GAME_ID__` with the kebab id and `__GAME_PASCAL__` with the PascalCase name, then run
`npx eslint --fix` on it, which orders the imports):

1. `parseBands(bandsJson)` reads the contract: the grid (policy → level difficulties 0..99),
   `seedsPerCell`, `maxMoves`, and the optional `endless` block.
2. `playCell(policy, difficulty)` runs `traceBot` for seeds `1…seedsPerCell`
   (`Array.from({ length: BANDS.seedsPerCell }, (_, index) => … seed: index + 1 …)`, the form
   `sim-seeds` checks) and `summarizeCell`s them, for every grid cell and then, with an `endless`
   block, once more for its policy at difficulty 100.
3. The report (`gameId`, `rulesFingerprint`, seeds, cap, cells) is written in `beforeAll`, before the
   assertions, so a failing run still leaves numbers to read.
4. Three tests: no run hit the move cap; replaying the first cell gives identical numbers;
   `bandProblems(report, bands)` is empty.

It lives under the root `test/` folder because it writes files with Node APIs (only the root
`tsconfig.json` has Node types; `src/` has none). Run it with `npm run test:sim` (all games) or
`npx jest test/sims/<game-id> --ci --config jest.sim.config.js` (one game; paths first in every jest
command). Keep one sim file under about 60 s; the report is one file per game, so do not split a
game's grid over two sim files.

## Real-time and simulate-then-replay games

- **Simulate-then-replay** (a shot whose physics play out, a cascade that resolves): the continuous
  phase runs inside `applyMove`, so these games are turn-based for bots. Use the standard sim; a shot
  is one move.
- **Real-time**: drive the same fixed-step `step(sim, command)` the UI thread runs with `runSimBot`.
  `examples/arena-chase/` is the complete worked example (steer, collect sparks, dodge chasers; every
  third spark a pulse throws close chasers back, the twist), and it passes `check-balance.mjs` in this
  skill's self-test. realtime-game-loop owns the sim itself; this skill only drives it.

| File (app repo) | What it is |
|---|---|
| `src/games/arena-chase/sim/arena-chase-sim.ts` | The fixed-step sim: typed arrays, `stepArenaChaseSim(sim, command)`, `drainArenaChaseEvents`, `arenaChaseOutcome` (won at the spark goal, lost at 0 hearts or when the 90 s round ends), `arenaChaseScore`; a `'worklet'` module, no allocation per tick |
| `src/games/arena-chase/sim/arena-chase-tuning.ts` | Every balance number: hearts, speeds in hundredths of a unit per tick, radii, the first-spark offset, sparks per pulse, the round length, and three level rows read by `knobsFor` (rowFor written out: a `'worklet'` module may call only worklets on the UI thread) |
| `src/games/arena-chase/sim/arena-chase-sim.test.ts` | Replay from the `(tick, command)` log, frame grouping, the opening, a finished run stays still |
| `src/games/arena-chase/testing/arena-chase-bot.ts` | `ARENA_CHASE_SIM: SimBotGame`, `tagArenaChaseEvent` (spark = payoff, a pulse that throws a chaser = twist), `commandToward` (best dot product, no angles) and the three players |
| `src/games/arena-chase/testing/arena-chase-bot.test.ts` | The tags, the direction choice, each policy's decision, idle losing fast and dodge winning the first round |
| `test/sims/arena-chase/balance.sim.test.ts` | `playCell` maps seeds to `runSimBot(ARENA_CHASE_SIM, { seed, difficulty, policy, maxTicks: BANDS.maxMoves, decideEveryTicks: 12, payoffStepTicks: 120 })`; the report, replay and bands tests are the template's |
| `test/sims/arena-chase/balance-bands.json`, `reports/sim/arena-chase.json` | The bands in ticks and seconds, and the real report they were set from |

A `CommandPolicy` reads the sim and returns an integer command (0 idle, 1-16 stick directions) plus
its RNG; `runSimBot` asks it every `decideEveryTicks` = 12 ticks (about a person's 100 ms). The
result is an ordinary `BotTrace` whose `moves` are ticks, so `summarizeCell` and the bands work
unchanged; write move bands in ticks (120 ticks = 1 s). The first-payoff curve counts
`payoffStepTicks` steps instead: with 120 at 120 Hz, `firstPayoffShare[k-1]` is the share of runs
with a payoff within k seconds, so `"withinMoves": 1` reads "within 1 second". The three standard
real-time players:

| Policy | What it does | What the example's report shows |
|---|---|---|
| `idle` | never moves | loses in about 2.7 s (median 327 ticks): the chasers have teeth |
| `wander` | a random direction at every decision, from its own RNG | collects no sparks and never wins: where the thumb goes matters |
| `dodge` | heads for the spark, pushed away from every chaser inside 200 units and from walls closer than 90, then takes the stick direction with the best dot product | wins 1.0 / 0.7 / 0.33 of the three rounds, first spark within 1 s in every run, about 2 pulses per round at d34 |

Every run must end before the cap, so a real-time game needs a round limit (the example: 10,800
ticks, 90 s; the bands' `maxMoves` 12,000 sits above it). Because `skillGap` compares policies at
one difficulty, use a metric that separates them (`medianScore`, sparks: wander 0 vs dodge 12 at
d34); `idle` is checked by a band on `medianMoves` ("loses within 1 to 5 seconds"). The checker
recognises a real-time bot by its `CommandPolicy` and the tuning file in `sim/`.

## Determinism, iOS and Android

- Seeds are `1…seedsPerCell`, the same every run. The bots take randomness only from their own
  sfc32 state; the game only from the state's.
- No `Math.random`, `Date`, `performance.now`, `jest.retryTimes`, `.skip`, `.only` in sims or bot
  hooks (`check-balance.mjs` fails on them; the lint config bans the first three in game code too).
- The report has no timestamps: rerunning unchanged code writes identical bytes, so a diff of
  `reports/sim/<game-id>.json` shows exactly what a change did.
- **The numbers are measured in Node (V8) and played on Hermes, on iPhones and Android phones.**
  They transfer only because the rules follow the determinism policy (exact integer and IEEE
  operations, no `Math.sin`/`pow`, no locale, game-rules-engine) and because a real-time sim counts
  fixed ticks, never display frames: a 60 Hz Android phone and a 120 Hz iPhone run the same 120
  ticks per second (realtime-game-loop). A balance claim never depends on frame rate or device speed.
- A sim that gives different numbers on a rerun is a determinism bug in the rules (a clock, an
  unseeded random, iteration over an object whose key order depends on insertion). Fix it first.

## Speed

The examples' sims run in seconds (Lights Out: 7 cells × 100 seeds; Pig: 10 cells; the arena chase:
7 cells of up to 12,000 ticks). What costs time: `listMoves` and `outcome` inside the bots' search,
and the lookahead cells. Keep `outcome` cheap, keep states small (flat arrays), and put lookahead
only where the skill gap is measured.

## Debugging a surprising number

1. Read the cell: `lossReasons` says how runs end (Pig's first run: 39 of 100 hold-at-20 runs ended
   in `pig.lose.bust-streak`, which explained why random play won more).
2. Replay one seed: `traceBot(GAME, { seed: 7, difficulty: 0, policy, maxMoves: 400, tagEvent, scoreOf })`
   in a scratch test, printing the `applyMove` events move by move.
3. Look at the state where it went wrong (render the board as ASCII if the game has one).
4. Decide whether the game, the bot or the band is wrong (tuning-playbook.md has the table).

## Reporting the numbers

The evidence report (git-commits-and-reporting) gets one plain line per difficulty, with numbers from
`reports/sim/<game-id>.json`, never from memory:

```text
- Bots (reports/sim/pig.json, 100 seeds each): a player who holds at 20 wins 84 % of the easiest
  levels, then 74 %, 63 % and 46 %; random play wins 41 % of the easiest and none of the hardest. A
  bot that sees the next rolls wins 90 % of the second row. Busts take a turn's points about three
  times per level; an endless run lasts a median 70 rolls.
```

and, until a person has played it, "Play-test pig on an iPhone and an Android phone" under "Human
checks (not blocking)".

## When multi-package

With npm workspaces (`apps/*`, `packages/*`) the kit and the harness usually live in a shared package
(`packages/game-core/src/{game,game-balance,rng}/`) and each game in an app. Pass the folders to the
checker (`--core-dir packages/game-core/src --games-dir apps/<app>/src/games --sims-dir test/sims`) or
set `coreDir`, `gamesDir` and `simsDir` in `rn-skills.config.json`, and set the same folders and the
package's import prefix (`alias: { prefix: '@acme/game-core/', target: 'packages/game-core/src/' }`) in
`SIM_LAYOUT` of `test/sims/write-sim-report.ts`, with a matching `paths` entry in the root
`tsconfig.json` (the checker resolves aliases from it). The writer and the checker must fingerprint the
same files, or every report reads as stale. Packages that ship TypeScript source write explicit `.ts`
extensions in their imports; the fingerprint resolves both spellings.
