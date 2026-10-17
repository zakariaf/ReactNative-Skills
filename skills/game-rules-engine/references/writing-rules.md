# Writing a game's rules

The order and the decisions for turning a game design into `src/games/<game-id>/rules/`, using the
template game (Lights Out with a move budget: tap a cell to toggle it and its neighbours, a dark board
wins, running out of moves loses) and the Pig example (a dice game that draws during play, with two
ways of losing, an endless run and a continue).

## Contents

- Before the first test
- Step 1: types (state, move, event)
- Step 2: tuning and create
- Step 3: outcome and listMoves
- Step 4: applyMove
- Step 5: the rules members (hud, undo, hints, continue)
- Step 6: persistence
- Step 7: statistics counters
- Step 8: bot and example states
- Step 9: the engine assembly
- Step 10: the module assembly, once the canvas exists
- Size limits and how to split
- Simulate-then-replay and real-time games

## Before the first test

1. Name the requirement the work serves (the app's spec ID or design note) and quote it in the first
   test's title or a comment (spec-traceability).
2. Classify the game: turn-based, simulate-then-replay or real-time (`engine-contract.md`).
3. Write down, in plain words: what a move is, when the game is won and each way it is lost, what the
   score is, whether undo is unlimited, limited or none, whether a solver can give hints, what the one
   continue does, whether there is an endless mode, and the input (taps only, swipe, drag or aim; a
   tap-then-tap selection). If the design does not say, ask the developer; the defaults are unlimited
   undo (none when the game draws during play), no hints, no continue, no endless mode, taps only.

## Step 1: types (state, move, event)

File `<game-id>-types.ts`.

- **State** is JSON-safe and complete: plain objects, arrays, finite numbers, strings, booleans,
  `null`. No `Map`, `Set`, `Date`, class instances, functions, `undefined` values, `NaN` or typed
  arrays (typed arrays live only in a real-time sim). Everything the next move needs is in it,
  including `rng: RngState` when the game draws during play (Pig) and counters such as `moves` and
  `maxMoves` (Lights Out).
- Prefer small integers: cells as `0 | 1`, positions as `row * cols + col`, scores as integers.
- **Move** says what the player chose in board terms: Lights Out `{ kind: 'toggle', col, row }`, Pig
  `{ kind: 'roll' } | { kind: 'hold' }`. Moves are imperative kebab-case kinds, logged and replayed,
  so they are JSON-safe too. A selection (tap a piece, then a cell) is never a move.
- **Events** are past tense, kebab-case, and carry every id and from/to value the animation and the
  statistics need: Lights Out `'cells-toggled' { cells }`, `'board-cleared'`; Pig `'die-rolled' { face }`,
  `'turn-busted' { lostPoints, busts }`, `'turn-banked' { points, banked }`. Anything that disappears
  must be drawable from its events alone, because the surface only receives the final state.
- Export `<Pascal>State`, `<Pascal>Move`, `<Pascal>Event` and `<Pascal>Result = ApplyResult<State, Event>`.

## Step 2: tuning and create

- Every balance number goes in `<game-id>-tuning.ts`: rows picked with `rowFor`, an endless row returned
  first when `isEndlessDifficulty(difficulty)` (Pig's `knobsFor`). The rules import these and hold no
  other balance numbers, so game-balance-and-bots can tune the game without touching the rules.
- `create(seed, difficulty)` clamps the difficulty (`clampDifficulty`), reads its knobs and keeps the
  mapping monotonic: more difficulty never makes a level easier. Store the clamped difficulty in the
  state when later rules need it (Pig's `state.difficulty`).
- Draw randomness only through `seedRng(seed)` and `nextInt`, threading the state through a loop.
  Lights Out draws only here and drops the stream; Pig draws nothing yet and stores the warmed-up
  stream for the rolls to come.
- Guarantee a playable start: `outcome(create(...))` is `playing`. Lights Out scrambles a dark board
  with seeded presses, which also makes every level solvable in at most `presses` moves;
  generate-and-test generators belong to level-generation-and-solvers.
- Pin one golden in the tests: `GOLDEN_SEED_1_BOARD` (the board `create(1, 0)` makes) or, for a game
  that draws during play, `GOLDEN_SEED_1_ROLLS`. A diff there means shipped levels changed.

## Step 3: outcome and listMoves

- `outcome(state)` checks the win first ("won beats lost": clearing the board with the last move wins),
  then each loss, then `playing`. A deliberate exception is documented in `outcome.ts`: Pig checks the
  bust streak before the turn budget so the reason names what actually ended the run.
- Win score: a whole number >= 0 (Lights Out: spare moves x 10; Pig: banked points plus spare turns x
  10). An endless run (target 0 in Pig) is never won.
- Loss: `{ kind: 'lost', reasonKey: '<game-id>.lose.<reason>' }`, one key per way of losing, the reason
  in kebab words for what happened (`lights-out.lose.out-of-moves`, `pig.lose.bust-streak`,
  `pig.lose.out-of-turns`), and every key in every catalog of the app.
- `listMoves(state)` returns `[]` when `outcome(state).kind !== 'playing'`, else every legal move in a
  fixed order (row by row; roll before hold). Bots, solvers and the contract test enumerate it; its
  order is part of determinism. `list-moves.ts` may import `outcome`.

## Step 4: applyMove

1. Validate: the game is still playing and the move is one `listMoves` offers (inside the board,
   whole-number cells, a hold only with points to bank). If not:
   `throw new RangeError(\`illegal move ${JSON.stringify(move)}\`)`. The host only passes moves the
   intent function built from `listMoves`, so a throw means a bug, and failing loudly beats corrupting
   a save.
2. Build the next state with spreads and `map`; never assign into the input (`state.cells[i] = ...` is
   a bug the contract test catches: the undo history and the saved snapshot share references).
3. Draw from `state.rng` and put the advanced stream in the next state.
4. Collect events in the order they happen (`cells-toggled`, then `board-cleared`; `die-rolled`, then
   `turn-busted`) and return `{ state: next, events }`.

## Step 5: the rules members (hud, undo, hints, continue)

In `<game-id>-engine.ts` as `<CONST>_RULES: GameRules<State, Move, Event>`:

- `hud(state)`: `{ score, goal: { id: '<game-id>.hud.<name>', values } }`, one ICU message with
  placeholders ("Moves {moves, number} / {maxMoves, number}"). Pig switches to `pig.hud.endless` in
  the endless run.
- `undo`: `{ kind: 'unlimited' }` for puzzles, `{ kind: 'limited', perLevel }` or `{ kind: 'none' }`
  otherwise (Pig: none, since undoing a roll would dodge a bust).
- `hints`: `{ kind: 'none' }` until the game has a solver; then `{ kind: 'solver', suggest }` where
  `suggest(state)` returns the first move of a solver line within a small node budget, or `null`.
- `continueRun`: `{ kind: 'once', descriptionId: '<game-id>.continue.<name>', apply }` where
  `apply(lost)` returns a playing state and its events, whatever way the run was lost. Lights Out adds
  3 moves (`moves-added`); Pig (`examples/pig/rules/continue-run.ts`) clears the bust streak and adds
  turns when they ran out, keeping the stream. Test it from each loss.

## Step 6: persistence

`<game-id>-persistence.ts` exports `<CONST>_PERSISTENCE: PersistenceSpec<State, Move>`:

- `parseState(json)` rebuilds a fresh typed object from unknown JSON with explicit checks (whole
  numbers, array lengths, allowed cell values, four 32-bit words for a stream), returning `null` on
  anything unexpected. Never cast `json as State`: a damaged or old save then crashes later instead of
  being dropped alone.
- `parseMove(json)` does the same for one logged move.
- `stateVersion: 1` at first; when the state or move shape changes after a release, bump it and make
  `migrateState(json, fromVersion)` upgrade older runs (or return `null`, which drops only the run in
  progress; results are kept).
- `savePolicy: { kind: 'after-every-move' }` for turn-based and simulate-then-replay games.

## Step 7: statistics counters

`<game-id>-stats.ts` exports `<CONST>_STATS: StatsSpec<Event>` with 2 to 4 counters:

- `id`: kebab-case and permanent (a key in stored statistics), e.g. `'cells-toggled'`.
- `labelId`: `'<game-id>.stats.<id>'`, in every catalog.
- `aggregate: 'sum'` (totals) or `'max'` (records such as "best turn").
- `measure(events)`: a number from one move's events, pure and cheap (the host replays the whole kept
  move line at the end of a run). dates-streaks-and-statistics stores the folded values.

## Step 8: bot and example states

`src/games/<game-id>/testing/<game-id>-testing.ts` exports `<CONST>_TESTING: TestingSpec<State, Move>`:

- `bot`: a reasonable player, greedy on an immediate measure (fewest lit cells) or a classic strategy
  (Pig: hold at 20). It receives an `rng` and returns it, advanced only if it drew. `randomPolicy()`
  from `src/core/game/testing/play-bot.ts` is the baseline. A game that draws during play gets a
  rule a person could follow, never a one-move lookahead: applying a move reveals the next draw from
  `state.rng`, so a greedy bot would see the dice before it decides. Keep such a policy in `rules/`
  (Pig: `rules/pig-hold-policy.ts`, which level-generation-and-solvers' witness also plays) and
  re-export it from the testing file. The starter bot is a floor for the contract tests;
  game-balance-and-bots replaces it with the tuned player its sims use.
- `examples.start/middle/win/lose`: functions returning states whose `outcome` matches the name; the
  screenshot matrix, a debug menu and E2E setup load them.

Bot balance runs (`*.sim.test.ts`, difficulty curves) belong to game-balance-and-bots.

## Step 9: the engine assembly

`rules/<game-id>-engine.ts` exports `<CONST>_ENGINE: GameEngine<State, Move, Event>` (`{ create,
listMoves, applyMove, outcome }`) and `<CONST>_RULES`. It is assembly only, pure, and lives in
`rules/`. Copy `<game-id>-engine.test.ts`: it runs `engineContractProblems` over seeds and difficulty
bands without any input and, for a game with an endless mode, with `endless: { kind: 'endless',
difficulty: ENDLESS_DIFFICULTY }` (`examples/pig/rules/pig-engine.test.ts`).

## Step 10: the module assembly, once the canvas exists

When canvas-gestures-and-hit-testing has written `src/games/<game-id>/canvas/intent-to-move.ts`,
write `src/games/<game-id>/<game-id>-game.ts` from `examples/lights-out-module/lights-out-game.ts`:
`identity` (`id` = the folder), `engine`, `input` with `panMode` and `selectRegions` as literals
next to `intentToMove`, `rules`, `persistence`, `stats`, `testing`, `levels` (`null` until
level-generation-and-solvers adds them). Then copy `lights-out-game.test.ts` and swap in the game's
own intents: a tap on every cell (with `selected: null`) and on a row outside the grid, taps on the
select regions, and the swipes, drags or aims its pan mode sends (plus the ones it never sends, which
must give `null`). Until the intent function exists the checker prints one SKIP for the module.

## Size limits and how to split

The project's lint limits apply to rules too (typescript-and-lint-rules owns the table): at most 250
lines per file, 40 lines per function, cyclomatic complexity 10, cognitive complexity 15, 3 parameters,
nesting depth 3, 4 nested callbacks in tests, no nested ternaries. Split by responsibility: one engine
function per file, helpers in their own file (`toggle-cells.ts`, `roll-die.ts`, `continue-run.ts`),
one object parameter when a helper needs more than three inputs. Under `noUncheckedIndexedAccess`,
handle `undefined` explicitly or reduce over a non-empty table (the tuning's `knobsFor`) instead of
adding branches the tests cannot reach.

## Simulate-then-replay and real-time games

- **Simulate-then-replay**: `applyMove` runs the continuous phase with the fixed step `1000 / 120` ms
  and the determinism policy, then returns events with timestamps (`atMs`). `buildTimeline` on the
  surface turns them into tracks. Everything else (saving, undo, bots, goldens) stays turn-based.
- **Real-time**: the rules still own `create`, the JSON snapshot state and `outcome`; the moving world
  is a typed-array sim in `src/games/<game-id>/sim/`, stepped with integer commands, saved at save
  points. Build it with realtime-game-loop.
