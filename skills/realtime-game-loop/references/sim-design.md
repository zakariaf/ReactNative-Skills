# Designing a real-time sim

What `src/games/<game-id>/sim/<game-id>-sim.ts` must look like so it runs on the UI thread without
allocating, replays bit-exactly, and saves cleanly. Read this before writing or changing a sim.

## Contents

- State: typed arrays in one shared value
- One tick
- Events
- Randomness: the sim's own sfc32 words
- The determinism policy in a sim
- Input: integer commands and the (tick, command) log
- Tests: replay and frame grouping
- Save points
- The RealtimeSpec: plugging the sim into the game module

## State: typed arrays in one shared value

```ts
export type BounceArenaSim = {
  readonly body: Float32Array;   // per entity, stride 4: x, y, vx, vy (entity 0 = the player)
  readonly ints: Int32Array;     // header [tick, entityCount, lastCommand, eventCount], then event triples
  readonly rng: Uint32Array;     // the sim's own sfc32 state (4 words)
};
```

- One plain object of typed arrays in `useSharedValue(realtime.createSim(state))`. On the UI thread
  `sim.get()` is the live object; the loop mutates it in place and calls `sim.modify()`. A JS read with
  `sim.get()` receives a copy (use it for save points).
- Allocate every buffer once (sized for the maximum: `MAX_ENTITIES`, `MAX_EVENTS`), never per tick. A
  full event queue drops the event rather than growing, but input, save-point and run-end events are
  never dropped: the queue keeps `RESERVED_EVENTS` slots (one of each per frame) that only those kinds
  may use (see Events).
- Mutating arrays in place is allowed only in `src/games/*/sim/**` and in the spatial hash's scratch
  buffers. The canonical ESLint config relaxes `no-param-reassign` (props) for exactly
  `src/games/*/sim/**/*.ts`; the spatial hash writes through local aliases of its buffers instead.
- Positions and velocities are world units (for example a 1000 × 1000 arena) and speeds are per tick.
  The draw function scales the world to the canvas.
- The file starts with `'worklet';` and imports values only from other `'worklet'` modules
  (`@/core/rng/sfc32`, `@/core/geom/*`, its own constants). It imports nothing from React, React
  Native, Expo, Skia or the app's routes, features, stores, services, ui, canvas or hooks.

## One tick

`step<Game>Sim(sim, command)` advances exactly one tick:

1. If `command` differs from `ints[LAST_COMMAND]`, push an input event and store it (this is the replay log).
2. Move the player from the command's direction table.
3. Move every other entity (the gameplay: chase, collide via the spatial hash, spawn from the RNG).
4. `ints[TICK] += 1`; push a wave-end event when a wave ends (a save point).

No allocation (no `new`, no `Array.from`, no `.map`/`.filter`/`.push`, no object or array literals, no
`vec2`/`sweep` calls in the hot path: they return new objects, so write the maths with scalars on the
typed arrays, see geom-kit.md), no module-level variables, no clock, no `scheduleOnRN`, no React, no
app imports. The loop calls it 1–30 times per frame. The checker follows every helper an exported
`step…` function reaches, in the same file or imported from a sibling file of the same `sim/` folder;
it does not follow helpers in other folders, so **keep a sim's per-tick helpers in its `sim/` folder**
(references/checker.md lists the other limits).

## Events

- The sim appends `[kind, value, tick]` integer triples to `ints` (after the header): `EVENT_INPUT`
  (value = command), `EVENT_EDGE`/`EVENT_HIT` (value = entity), `EVENT_WAVE_END`, a run end.
- `drain<Game>Events(sim)` copies the triples out as a flat number array and clears the count.
  `runLoopFrame` calls it once per frame and sends the batch to JS with one `scheduleOnRN`; JS plays
  sounds and haptics (audio-and-haptics-feedback), updates the HUD and statistics through the session,
  and takes save points.
- Event kinds are small integer constants exported by the sim file; JS maps them to sound ids and
  session actions.
- **Input, save-point and run-end events are never dropped.** A catch-up frame runs up to 30 ticks, and
  a burst of edge or hit events can fill the queue (`MAX_EVENTS` triples per frame). A lost input change
  breaks the `(tick, command)` log, so the saved run no longer replays; a lost wave end skips a save.
  `pushEvent` stops other kinds `RESERVED_EVENTS` (3) slots early and lets only the kept kinds
  (`isKeptEvent`: input and wave end; add the game's run-end kind) use the last slots. Each kept kind
  happens at most once per frame (the command is read once per frame, a wave is far longer than 30
  ticks), so they always fit. The template test floods a catch-up frame with edge events and still finds
  both triples.

## Randomness: the sim's own sfc32 words

The sim takes every random number from the app's seeded PRNG, `src/core/rng/sfc32.ts`
(seeded-determinism-and-golden-vectors owns it; it carries a file-level `'worklet'`), keeping its 4-word
state in `sim.rng`:

```ts
import { nextU32, seedRng } from '@/core/rng/sfc32';
// seedRng(seed) → RngState (4 uint32 words); nextU32(state) → { value: 0 … 2^32-1, state }

function drawU32(sim: Sim): number {
  const state: RngState = [sim.rng[0] ?? 0, sim.rng[1] ?? 0, sim.rng[2] ?? 0, sim.rng[3] ?? 0];
  const draw = nextU32(state);
  sim.rng.set(draw.state);
  return draw.value;
}
```

`sim.rng.set(seedRng(seed))` initialises it. Never `Math.random`. `drawU32` builds a 4-word array and a
result object per draw: fine for occasional draws (spawns, respawns), and the checker exempts a helper
that calls `nextU32` only for that state tuple (the rest of the helper, and every helper it calls, is
still checked). For randomness per entity per tick use `hashU32(a, b)` from the same module (for
example `hashU32(runSeed + tick, entity)`, with the run's seed kept in the sim header), which
allocates nothing.

## The determinism policy in a sim

The policy is stated once by seeded-determinism-and-golden-vectors (and applied to rules by
game-rules-engine); this skill's checker enforces it in sims, the real-time kit, the geometry kit and
simulate-then-replay rules:

- allowed: `+ - * /`, `%`, bitwise operators, `Math.sqrt`, `Math.imul`, `Math.floor`, `Math.round`,
  `Math.abs`, `Math.min`, `Math.max`, `Math.PI`;
- banned: `**`, every other `Math.*` (`sin`, `cos`, `atan2`, `exp`, `pow` …), `Math.random`, `Date`,
  `performance.now`, `Intl`.

Why: Hermes computes `sin`/`cos`/`exp`/`pow` with each platform's libm (iOS and Android differ) while
Jest runs V8, so replays and daily seeds would diverge; `+ - * /`, `%` and `sqrt` are exactly specified
by IEEE 754 and ECMA-262 (sources: Hermes `lib/VM/JSLib/MathStdFunctions.def`, ECMA-262 "Properties of
the Math Object"). Consequences: no angles in simulation (directions come from committed tables of unit
vectors, reflection uses dot products), integers where possible (HP, scores, ticks), floats for
positions are fine. The canonical ESLint config enforces the same list in
`src/games/*/{rules,levels,sim,geom}/**`; in `src/core/realtime/` and `src/core/geom/` this checker does.

## Input: integer commands and the (tick, command) log

- Gesture worklets write an integer command into the loop's `command` shared value (the canvas kit's
  stick: 0 idle, 1…16 directions). The sim never sees a float from a gesture.
- Command k (1…16) = `(cos((k-1)·22.5°), sin((k-1)·22.5°))` with y pointing down. The table is
  committed as literals and must match canvas-gestures-and-hit-testing's `STICK_DIRECTIONS` in value
  and order (the checker's `stick-table` rule compares a sim's `STICK…` table with the formula).
- The sim records every change as `EVENT_INPUT (tick, command)`; `commandLog(events, EVENT_INPUT)`
  (`src/core/realtime/replay-commands.ts`) turns drained events into the log, and
  `replayCommands({ sim, step, ticks }, log)` replays it.

## Tests: replay and frame grouping

Every sim ships a `*.test.ts` next to it (template `<game-id>-sim.test.ts`) with at least:

1. **Replay:** play N ticks with a scripted bot, grouping ticks into frames of varying size, collect the
   input log; replay the log tick by tick into a fresh sim; the fingerprints (every body value, the
   header, the RNG words) are identical. (A test title containing "replay".)
2. **Frame grouping:** the same bot stepped one tick at a time and grouped into 1–3 tick frames gives
   the identical world (60 vs 120 Hz cannot change the outcome). (A title containing "group", "frames"
   or "60 vs 120".)
3. **Time is ticks, events drain once, a full queue drops edge and hit events but keeps the input and
   save-point events, bodies stay inside the arena.**

These are plain `*.test.ts` unit tests, not `*.sim.test.ts`: that suffix belongs to the headless balance
simulations of game-balance-and-bots, which reuse the same `step` thousands of times with seeded bots.

## Save points

At a save point the host takes `sim.get()` on JS (a copy of the typed arrays) and hands it to the
board, which calls game-session-host's `GameSurfaceProps.onSavePoint(realtime.snapshot(copy),
inputLog)`: the host writes it through its run store and persist step (session-flow.md there, "Real-time
games and save points"), never a direct write. The run's end is one final save point with the final
snapshot; the host records the run once and then sets `isEnded`. At pause, background, blur or an
interruption the host stops the loop first; at the end of a wave (a drained batch for which
`isSavePoint(events)` is true) it copies between two frames and the loop keeps running. Restoring
creates the shared value from `realtime.createSim(saved)`. Never save per frame: a frame is 8.3 ms at
120 Hz and the storage write budget is for moves and settings.

## The RealtimeSpec: plugging the sim into the game module

game-rules-engine's kit keeps the `GameModule` contract and `SavePoint`; a real-time game attaches its
sim by intersection, `GameModule<...> & { readonly realtime: RealtimeSpec<State, Sim, SavePoint> }`.
The type lives in `src/core/realtime/realtime-spec.ts`:

```ts
export type FixedStepSim<TSim> = {
  readonly step: (sim: TSim, command: number) => void;          // worklet: one tick
  readonly drainEvents: (sim: TSim) => readonly number[];       // worklet: this frame's triples
};
export type RealtimeSpec<TState, TSim, TPoint extends string = string> = FixedStepSim<TSim> & {
  readonly createSim: (state: TState) => TSim;                  // JS: typed arrays from JSON
  readonly snapshot: (sim: TSim) => TState;                     // JS: JSON from a sim copy, at save points only
  readonly savePoints: readonly TPoint[];                       // e.g. wave end, pause, background
  readonly isSavePoint: (events: readonly number[]) => boolean; // a drained batch holds a save-point event
};
```

- The template is `src/games/<game-id>/<game-id>-realtime.ts`, outside `sim/` (it is JS-thread
  assembly, not a worklet). `step` and `drainEvents` are the sim file's functions, so the game screen
  passes `game={realtime}` to `RealtimeCanvasHost` unchanged, with `initialSim={realtime.createSim(state)}`
  and `isSavePoint={realtime.isSavePoint}`.
- `snapshot` turns the typed arrays into plain number arrays (`Array.from(copy.body)`) so the state
  stays JSON (game-rules-engine rule: no typed arrays in state); `createSim` rebuilds them. The rules'
  `create()` keeps the starting snapshot in the game state.
- **Test the round trip** (the checker's `realtime-spec` rule looks for a test title containing "round
  trip"): `snapshot(createSim(snapshot(sim)))` equals `snapshot(sim)`, the saved state survives
  `JSON.stringify`, and a restored run continues exactly like the original.
- `persistence.savePolicy` is `{ kind: 'save-points', points: [...] }` for a real-time game, with the
  same points as `realtime.savePoints` (turn-based games use `{ kind: 'after-every-move' }`).
- The input log is built on JS from each batch's `EVENT_INPUT` triples and saved next to the snapshot,
  so a restored run can be replayed from its start. The copy can be a few ticks newer than the batch
  that triggered it (the loop keeps running while JS handles a wave-end batch), so the log may end
  before the snapshot's tick. Restoring uses the snapshot alone and is exact; export a debug replay
  from a paused game (loop stopped, its last batch arrived), never straight from a wave-end save.
