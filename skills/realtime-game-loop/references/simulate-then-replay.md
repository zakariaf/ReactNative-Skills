# Simulate-then-replay

How turn-based games with a continuous phase (a shot that ricochets, a ball dropping through pegs, a
cascade that settles) compute that phase inside the pure reducer that applies the player's move and
replay it on screen as an ordinary timeline. Read this before building such a game.

## Contents

- The idea
- The fixed step inside the reducer
- Timed events
- From events to tracks
- The collision recipe (ricochet volley)
- Discrete runs (drops and cascades)
- Tests

## The idea

The player's move (a shot, a dropped ball) starts a continuous process. Instead of running it live,
`applyMove` (game-rules-engine) runs it to the end with the same fixed step the real-time loop uses and
returns an event list with timestamps: `{ kind: 'ball-bounced', ballId, x, y, atMs }`. The game stays
turn-based: saves, undo, bots, solvers and goldens all work on `applyMove` as usual; only the picture
moves in real time, driven by skia-canvas-rendering's scene clock and the surface's `buildTimeline`.
Running a volley live in a frame loop instead breaks all of that.

## The fixed step inside the reducer

- Advance in ticks of `STEP_MS = 1000 / 120` (`import { tickToMs } from '@/core/realtime/fixed-step'`),
  with velocities in world units per tick.
- Loop until every body is done or a hard `maxTicks` cap is reached: a volley always ends, and a bot or
  a solver never hangs.
- The code lives in `src/games/<game-id>/rules/` (pure and deterministic): no React, Skia or app imports,
  no clock, no `Math.random` (the RNG state lives in the game state), only the allowed `Math.*`
  functions. The canonical ESLint config makes `rules/` a pure and deterministic zone; the checker also
  applies its determinism rule to every rules file that imports the fixed-step module.
- It runs on the JS thread, so it may allocate normally (arrays of events, immutable vectors from
  `@/core/geom`); only the real-time sim has the no-allocation rule.

## Timed events

- `atMs = tickToMs(tick)` (`Math.round(tick × STEP_MS)`): integer milliseconds on the timeline.
- Emit an event at every point where motion changes: launch, each bounce, exit or stop. For
  straight-line motion between events, that is enough to reproduce the path exactly.
- With gravity, curves or friction, the path between events is not straight: also emit a position event
  every few ticks (for example every 6 ticks, 50 ms) so linear tracks stay within a pixel of the true path.
- Events carry every id and coordinate the animation needs; `buildTimeline` never looks at state
  (game-rules-engine's event rule).

## From events to tracks

`volleyTracks(events)` (example `volley-timeline.ts`, in the surface folder
`src/games/<game-id>/canvas/`): for each ball, one linear `ball` track from each event point to the
next, starting at the earlier `atMs` and lasting until the later one, with a sound cue on bounces
(`Track` from `@/canvas/timeline/track`). Under reduced motion keep the tracks (they carry the outcome)
but drop particle bursts. The surface's scene clock then plays them like any turn: the view pushed with
the tracks is the final state.

## The collision recipe (ricochet volley)

Per fixed step, for each ball:

1. Sweep the circle's motion for this step against every wall segment and brick edge (a brick is 4
   segments): `sweepCircleSegment({ center, motion, radius }, segment)` returns the contact fraction `t`
   (0…1) and the surface normal, including the rounded segment ends.
2. Take the earliest hit; move to it (`pos + motion × t`).
3. Reflect the velocity: `reflect(v, n) = v − 2(v·n)n` (no angles).
4. Spend the remaining fraction of the step (`remaining × (1 − t)`); repeat at most 4 times per step.
5. With many balls, use the spatial hash for ball-ball overlap (`circlesOverlap(a, b, radiusSum)`
   compares squared distances, no `sqrt`).

`examples/ricochet-volley/simulate-volley.ts` implements steps 1–4 for an open-bottom box.

## Discrete runs (drops and cascades)

Not everything continuous needs geometry. A ball dropping through flip-flop gates, or a cascade of
falling tiles, is a discrete sequence: compute it step by step in `applyMove`, emit one timed event per
step (`atMs = step × STEP_DURATION_MS`), and let `buildTimeline` chain the tracks with delays. Same rules:
pure, capped, deterministic, timed.

## Tests

`examples/ricochet-volley/simulate-volley.test.ts` shows the required properties (fast-check with fixed
seeds):

- every contact stays inside the arena;
- a ball never speeds up (distance between consecutive events ≤ speed × ticks);
- the same shot always gives the same events (replays, daily challenges and goldens depend on it);
- the tracks built from the events replay the path (one track per consecutive event pair, starting at
  the launch point; `volley-timeline.test.ts`, beside the surface).
