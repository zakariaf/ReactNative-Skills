# The game contract and the engine

What a game hands the app, member by member, and what each engine function must do. The type files
are in `templates/src/core/game/`; copy them verbatim, they are canonical.

## Contents

- Why a contract, and why it is pure
- Where the code lives
- The engine members (`GameEngine`)
- One difficulty scale, and the endless run
- The input members (`GameInput`)
- Tap-then-tap: the selection is UI state
- Rules beyond the engine (`GameRules`)
- Persistence, statistics and testing members
- The module (`GameModule`) and how the host binds it
- Contract tests every game runs
- Classifying a game: turn-based, simulate-then-replay, real-time
- When multi-package

## Why a contract, and why it is pure

A game plugs into the app through one value, its `GameModule`. Bots, solvers, saves, undo, the daily
level, replays and golden tests all call the engine headlessly, thousands of times, in Jest and in
plain Node. So the engine functions are pure TypeScript on the JS thread: no React, React Native,
Expo, Skia, state-library or app imports, no clock, no ambient randomness, and the same answer on an
iPhone, an Android phone, a CI runner and a developer laptop.

```
 gesture --CanvasIntent--> intentToMove(state, intent) -> Move | null        (canvas/, pure)
                                   |
        session store: applyMove(state, move) -> { state, events }; run saved  (game-session-host)
                                   |
        surface: toView(state) + buildTimeline(events) -> animation on the UI thread (skia-canvas-rendering)
```

The picture shown after a move is always the final state; `events` explain how it got there.

## Where the code lives

```
src/core/game/                    the kit: pure TS, imports only src/core (the canonical PURE zone)
  game-engine.ts game-input.ts game-rules.ts game-module.ts messages.ts levels.ts
  persistence.ts stats.ts testing.ts difficulty.ts (+ test)
  testing/  play-choices.ts play-bot.ts json-shape.ts engine-contract.ts contract-intents.ts (+ tests)
src/core/rng/sfc32.ts (+ test)    the seeded RNG (canonical; seeded-determinism-and-golden-vectors owns it)
src/games/<game-id>/
  rules/                          PURE + DETERMINISTIC: imports src/core and its own rules/levels/geom
    <game-id>-types.ts            state, move, event types
    create.ts list-moves.ts apply-move.ts outcome.ts      one engine function per file
    <helpers>.ts                  e.g. toggle-cells.ts, roll-die.ts, continue-run.ts
    <game-id>-tuning.ts           every balance number (game-balance-and-bots tunes it)
    <game-id>-engine.ts           <CONST>_ENGINE (GameEngine) and <CONST>_RULES (GameRules): assembly only
    <game-id>-persistence.ts  <game-id>-stats.ts
  testing/<game-id>-testing.ts    bot + example states (TestingSpec)
  canvas/intent-to-move.ts        the intent function (canvas-gestures-and-hit-testing writes it)
  canvas/...                      the surface: layout, draw, build-timeline (skia-canvas-rendering)
  <game-id>-game.ts               <CONST>_GAME: GameModule, assembled once the canvas exists
  levels/  sim/  geom/            level-generation-and-solvers, realtime-game-loop
```

Imports: siblings with `./x`, everything else through the `@/` alias (`@/core/game/game-engine`,
`@/games/<id>/rules/create`); parent-relative `../` imports are banned by the canonical lint. The
canonical ESLint config makes `src/core/**` and `src/games/*/{rules,levels}/**` a pure zone (the
`@/` alias is allowed only for `src/core/` and the game's own `rules/`, `levels/`, `geom/`) and
`src/games/*/{rules,levels,sim,geom}/**` a deterministic zone; architecture-and-boundaries' checker
adds `game-to-game` (a game never imports another game) and `game-facing` (outside `rules/` and
`levels/`, a game faces only `src/core`, `src/ui`, `src/theme`, `src/i18n`, `src/canvas`, port types
and the host's seam).

## The engine members (`GameEngine`)

| Member | Signature | Must |
|---|---|---|
| `create` | `(seed, difficulty) => TState` | Same pair, same state on every device. Accept any difficulty and clamp it to 0..100 (`clampDifficulty`). Start in play: `outcome` is `playing`. |
| `listMoves` | `(state) => readonly TMove[]` | Every legal move in a fixed order (bots, solvers and replays depend on the order). Empty exactly when `outcome` is not `playing`. |
| `applyMove` | `(state, move) => { state, events }` | Pure: never change the input. Throw `RangeError` for a move `listMoves` does not offer, instead of returning the old or a corrupted state. |
| `outcome` | `(state) => Outcome` | `{ kind: 'playing' }`, `{ kind: 'won', score }` (a whole number >= 0) or `{ kind: 'lost', reasonKey }` (a `<game-id>.lose.<reason>` catalog key). |

`Outcome` and `ApplyResult<TState, TEvent> = { state, events }` live in `game-engine.ts`. The names
are canonical: the host, the bots, the solver and the checker call them by these names.

## One difficulty scale, and the endless run

Every game uses one scale: whole numbers 0..100, the range a saved run may hold. `difficulty.ts`:

| Export | Meaning |
|---|---|
| `ENDLESS_DIFFICULTY = 100` | Reserved for the endless run. Only a game with an endless mode gives it that meaning; for any other game 100 is simply the hardest value `create` must still accept. |
| `MAX_LEVEL_DIFFICULTY = 99` | The top of the level scale: every level, pack entry and the daily stay at or below it. |
| `clampDifficulty(d)` | `min(max(floor(d), 0), 100)`: what `create` stores. |
| `isEndlessDifficulty(d)` | `clampDifficulty(d) === 100`. |
| `rowFor(d, rowCount)` | `floor(min(max(floor(d), 0), 99) * rowCount / 100)`: the row of a tuning table, easiest first. With four rows, 0-24 is row 0, 25-49 row 1, 50-74 row 2, 75-99 row 3. |

- **The curve, the rows and the daily line up on this scale.** `levels.difficultyFor(level)` rises
  from 0 at level 1 towards 99 (or a lower cap the game's solver can still prove). The tuning file
  maps a difficulty to knobs with `rowFor`, so every level and the daily land on a real row. A
  medium daily (40 to 50) is a good default.
- **An endless run is `create(freshSeed, ENDLESS_DIFFICULTY)`.** There is no mode argument: a mode
  flag would be a second scale the save, the curve and the bots must all learn. The tuning has an
  endless row (no goal), `knobsFor(100)` returns it, and `outcome` never returns `won` at 100: an
  endless run only ever ends lost, and the host shows "new best" when the score beats the stored best.
  `examples/pig/` is a complete endless game.
- `engineContractProblems` proves it: given `endless: { kind: 'endless', difficulty: ENDLESS_DIFFICULTY }`
  it also plays seeded games from `create(seed, 100)` and reports any `won`. The checker does the same
  (`endless-won`) for any game whose code declares an endless mode (`kind: 'endless'` or a call to
  `isEndlessDifficulty`).

## The input members (`GameInput`)

| Member | Type | Meaning |
|---|---|---|
| `panMode` | `'none' \| 'swipe' \| 'drag' \| 'aim'` (data) | The pan gesture the surface turns into intents; taps and long presses always work. Lights Out `'none'`, a sliding puzzle `'swipe'`, drag-to-place `'drag'`, pull-and-release `'aim'`; real-time games steer with a stick and declare `'none'`. |
| `selectRegions` | `readonly string[]` (data) | Regions whose taps select instead of act (a tray of pieces); `[]` for most games. |
| `intentToMove` | `(state, intent) => TMove \| null` | Pure. Returns only moves `listMoves` lists, `null` for everything else; every intent kind is handled explicitly. |

`GameInput<TState, TMove, TIntent extends GameIntent>` is generic over the intent because the pure
zone of `src/core` cannot import the canvas kit: in the app `TIntent` is canvas-gestures-and-hit-testing's
`CanvasIntent` (`tap { target, selected }`, `long-press { target }`, `swipe { direction, from }`,
`drag-end { from, to }`, `aim { dx, dy }`, a target being `{ regionId, col, row }`). The intent
function lives at `src/games/<game-id>/canvas/intent-to-move.ts`, beside the surface, for the same
reason; it imports the rules' types and `listMoves` through `@/games/<game-id>/rules/...` and is just
as pure.

Which intents the surface sends depends on `panMode`: taps and long presses always, `swipe` only with
`'swipe'`, `drag-end` only with `'drag'`, `aim` only with `'aim'`. The contract test fails when
`intentToMove` turns an intent into a move that the declared pan mode never sends (a swipe game left
on `'none'` is unplayable), and when `panMode` is not one of the four.

## Tap-then-tap: the selection is UI state

Some games are played by tapping a piece, then its target. The selection is never game state and never
a move, so bots, the solver, par, undo and the statistics counters never see it:

1. The module lists the regions whose taps select in `selectRegions` (`['tray']`); most games `[]`.
2. The gesture layer always sends `tap` with `selected: null`. The screen's model hook keeps the
   selection: a tap inside a select region toggles it (the same target again clears it) and is
   announced to VoiceOver and TalkBack; any other tap calls `intentToMove(state, { ...intent,
   selected })`. A non-null move is applied and clears the selection; undo, restart, the end of the
   run, a miss and a drag clear it too.
3. `intentToMove` stays pure: a tap inside a select region returns `null`; a tap with a selection
   returns the move it names only when `listMoves` lists it.

The contract test proves both halves: taps inside `selectRegions` return `null`, and every tap outside
them is tried again with each tapped select target as `selected`; each resulting move must be listed.

## Rules beyond the engine (`GameRules`)

| Member | Type | Meaning |
|---|---|---|
| `hud(state)` | `{ score, goal: Message }` | The top bar: the score and one ICU goal line with placeholders, e.g. `{ id: 'lights-out.hud.moves', values: { moves: 3, maxMoves: 6 } }`. Never glued text. |
| `undo` | `none` / `unlimited` / `limited(perLevel)` | Unlimited suits puzzles; a game whose future is drawn from the RNG usually has none (undoing a roll would let a player dodge it). The host keeps the history. |
| `hints` | `none` / `solver(suggest)` | `suggest(state)` returns the next good move or `null`, usually the first move of a solver line (level-generation-and-solvers). |
| `continueRun` | `none` / `once(descriptionId, apply)` | One rescue per run, only after a loss. `apply(lost)` returns `{ state, events }` that is playing again from every way of losing. The host forbids undo across it and decides whether it is offered (a reward or a purchase belongs to the app). |

Defaults when the design is silent: unlimited undo for a puzzle (none when the game draws during
play), no hints until a solver exists, no continue.

## Persistence, statistics and testing members

- **`PersistenceSpec`**: `stateVersion` (bump when the shape of state or move changes), `parseState`
  and `parseMove` (rebuild a fresh typed value from unknown JSON or return `null`: the host then drops
  only the run, or only the undo history), `migrateState(json, fromVersion)` (`null` = cannot),
  `savePolicy` (`after-every-move` for turn-based games; `save-points` for real-time games, never per
  frame). persistence-and-migrations owns where the run is stored.
- **`StatsSpec`**: 2 to 4 `CounterSpec { id, labelId, aggregate: 'sum' | 'max', measure(events) }`.
  `measure` sees one move's events; at the end of a run the host replays the kept move line and folds
  each counter (undone moves never count). Ids are kebab-case and permanent.
- **`TestingSpec`**: `bot: BotPolicy` (`(state, moves, rng) => { move, rng }`, its own seeded stream,
  never `Math.random`) and `examples` for `start`, `middle`, `win`, `lose` (screenshots, a debug
  menu, E2E setup through debug-menu-and-test-hooks).

## The module (`GameModule`) and how the host binds it

`GameModule<TState, TMove, TEvent, TIntent>` = `identity` (`id` equals the folder `src/games/<id>`,
`nameId` is `'<id>.name'`), `engine`, `input`, `rules`, `persistence`, `stats`, `testing`, `levels`
(`null` until the game has levels). `examples/lights-out-module/lights-out-game.ts` is the whole
assembly. The kit cannot name Skia, sound or screen types, so the session host (game-session-host)
adds what only the app can type by intersection:

```ts
type HostedGame = GameModule<LightsOutState, LightsOutMove, LightsOutEvent, CanvasIntent> & {
  readonly surface: CanvasSurface<...>;     // skia-canvas-rendering
};
```

A real-time game attaches its sim the same way: `& { readonly realtime: RealtimeSpec<State, Sim> }`
(`createSim`, `step`, `drainEvents`, `snapshot`, ...). realtime-game-loop owns that type; the kit
keeps only `SavePoint` (in `src/core/game/persistence.ts`, for `savePolicy: save-points`), so a
turn-based game carries no real-time member at all.

Screens never see a game's types: the host's seam is the only generic code (architecture-and-boundaries
records it in `gameFacing`).

## Contract tests every game runs

| Test | Asserts | Where |
|---|---|---|
| start and determinism | `create(seed, d)` starts in play and twice gives deep-equal states; replaying a move line twice gives identical states | `rules/<id>-engine.test.ts` (`engineContractProblems`) |
| end state | `listMoves` empty exactly when `outcome` is not `playing`; lose reasons are `<id>.*` keys; win scores whole | the same |
| serialisation | states and moves are JSON-safe (`jsonShapeProblems` names the path); `parseState` / `parseMove` return saved values unchanged and `null` for damaged data (another JSON kind, `{}`, one field of the wrong type), which catches a cast | the same |
| purity | `applyMove` leaves its input untouched; event kinds are kebab-case | the same |
| endless | with `endless`, seeded play from `create(seed, 100)` never reaches `won` | the same |
| legality and pan mode | every move `intentToMove` returns is listed; `panMode` is one of the four and only its intents are accepted | `<id>-game.test.ts` (`input`, `intents`) |
| selection | `selectRegions` is a list; a tap inside it returns `null`; taps carrying a selection yield only listed moves | the same |
| levels, daily, par, stars | solvability and goldens | level-generation-and-solvers |

## Classifying a game: turn-based, simulate-then-replay, real-time

| Class | Examples | What changes |
|---|---|---|
| Turn-based | Lights Out, a sliding puzzle, Pig, solitaire, match-three | Nothing: apply the move, then animate its events. Timers count turns, never wall-clock time. |
| Simulate-then-replay | a shot that bounces, a cascade that settles | The continuous phase runs inside `applyMove` with a fixed step (1000 / 120 ms) and the determinism policy; the result is an ordinary event list with timestamps (`{ kind: 'ball-bounced', ballId, x, y, atMs }`). Saving, undo, bots and goldens stay turn-based. |
| Real-time | an arena chase | A typed-array sim in `src/games/<id>/sim/` stepped on the UI thread with integer input commands recorded as `(tick, command)`; the rules still own `create`, the JSON snapshot and `outcome`; `savePolicy: save-points`. realtime-game-loop builds it. |

## When multi-package

A games monorepo keeps the kit in a package (`packages/play-kit/src/` with `@<org>/play-kit/...`
imports) and each game in its own app or package. The contract does not change. Run the checker once
per app with the app folder as the repo root, and point it at the folders with `--core-dir`,
`--games-dir` and `--catalogs-dir` (or `rn-skills.config.json` keys `gamesDir` and
`gameCatalogsDir`); tsconfig `paths` and package.json `workspaces` resolve the imports.
