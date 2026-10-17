# check-realtime-loop.mjs

The checker's options, configuration keys, every rule with its typical fix, the lines a passing run may
print, and troubleshooting. Read it when a `FAIL` line is unclear or the app's folders differ from the
defaults.

## Contents

- Running it
- Folders and rn-skills.config.json keys
- What it finds
- Rules
- Passing output, NOT APPLICABLE and exit 2
- What the heuristic rules cannot see
- Troubleshooting

## Running it

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-realtime-loop.mjs .                 # from the app repo root
node ${CLAUDE_SKILL_DIR}/scripts/check-realtime-loop.mjs . --games-dir src/arcade
node ${CLAUDE_SKILL_DIR}/scripts/check-realtime-loop.mjs . --json          # also one JSON line of problems
```

Zero dependencies (Node 22.18 or newer). Exit 0 pass (NOT APPLICABLE included), 1 problems, 2 bad input.
Each problem is `FAIL <file>:<line> [<rule>] <message> Fix: <fix>`; the last line is `RESULT: PASS` or
`RESULT: FAIL (<n> problems)`.

## Folders and rn-skills.config.json keys

| Option | Config key | Default | What lives there |
|---|---|---|---|
| `--kit-dir` | `realtimeKitDir` | `{coreDir}/realtime` (`src/core/realtime`) | `fixed-step.ts` (+ test), `replay-commands.ts` (+ test), `realtime-spec.ts` |
| `--geom-dir` | `geomKitDir` | `{coreDir}/geom` | `vec2.ts`, `sweep.ts`, `spatial-hash.ts` (+ tests) |
| `--host-dir` | `realtimeHostDir` | `{srcDir}/canvas/realtime` | `run-loop-frame.ts` (+ test), `use-fixed-step-loop.ts`, `record-sim.ts` (+ test), `paint-sim-png.ts`, `realtime-canvas-host.tsx` (+ test) |
| `--games-dir` | `gamesDir` (shared with game-rules-engine) | `{srcDir}/games` | `<game-id>/sim/`, `<game-id>/rules/`, `<game-id>/canvas/`, `<game-id>/<game-id>-realtime.ts` |

`{srcDir}`, `{coreDir}` and `{testDir}` expand from check-lib's layout (`rn-skills.config.json` layout
keys, else `src`, `src/core`, `test`). Values are repo-relative folders; `..` is bad input. Imports are
resolved through `tsconfig.json` `paths` (the `@/` and `@test/` aliases) and package.json `workspaces`,
so a monorepo runs the checker from the repo root with these options pointing into its packages.

## What it finds

- **Real-time games:** every `<gamesDir>/<id>/` folder with a `sim/` subfolder. Its non-test `.ts`
  files are sims; `<id>/canvas/draw*.ts` are UI-thread draw files; its golden is any
  `*.golden.test.ts` under the test folder that imports from `games/<id>/canvas/`.
- **Simulate-then-replay rules:** every non-test `.ts` file under `<gamesDir>/<id>/rules/` that imports
  a value from `<kit>/fixed-step` (any spelling: `@/core/realtime/fixed-step`, a relative path, a
  workspace package).
- **Loop components:** every non-test `.ts`/`.tsx` file of the repo, scanned for `useFrameCallback`
  with `runLoopFrame` and for `useFixedStepLoop`. Installed skills (`.agents/`, `.claude/`, `skills/`,
  any folder holding a `SKILL.md`), `node_modules` and build output are never scanned.

## Rules

| Rule | Typical fix |
|---|---|
| `loop-file-missing` | Copy the named file from `templates/` (its first line names the path). The kit's tests are required too (`fixed-step`, `replay-commands`, `vec2`, `sweep`, `spatial-hash`); the host (with the `run-loop-frame` and `realtime-canvas-host` tests) once a sim exists. |
| `loop-import-unresolved` | A kit, host, sim or draw file imports something that does not exist; the line names the owner: `src/canvas/*` (draw kit, lifecycle, describe-error) skia-canvas-rendering, `src/core/rng/*` seeded-determinism-and-golden-vectors, `src/hooks/*` react-components-and-hooks, `src/core/game/*` game-rules-engine. |
| `step-constants` | `STEP_MS = 1000 / 120`, `MAX_FRAME_MS = 250`. |
| `loop-runner` | Restore `run-loop-frame.ts`: `planSteps`, `sim.modify()`, exactly one `scheduleOnRN(wiring.onEvents, events)` whose argument is the array assigned from `wiring.drainEvents(…)`, outside every loop body (a `for`/`while`/`do` block or statement, a `forEach`/`map`/`reduce` callback, on one line or several), `try/catch`. |
| `frame-callback-body` | `useFrameCallback((info) => { runLoopFrame(wiring, info.timeSincePreviousFrame); }, false)`; the parameter may be typed (`info: FrameInfo`) or destructured (`({ timeSincePreviousFrame })`). |
| `worklet-directive` | `'worklet';` as the first statement of sims, draw files and the UI-thread kit. |
| `worklet-import` | A worklet imports values only from worklet modules or `react-native-worklets`; use `import type` for types. |
| `determinism` | Only the allowed `Math.*`; no `**`, `Math.random`, `Date`, `performance.now`, `Intl`. |
| `sim-ticks` | Speeds per tick, timers in ticks; no `timestamp`, `timeSince*`, `STEP_MS`, `dtMs`, `deltaMs`, `elapsedMs` in a sim. |
| `sim-isolated` | No `scheduleOnRN`/`runOnJS` and no imports of React, React Native, Expo, Skia, worklets or the app's layers in a sim. |
| `sim-no-alloc` | Allocate in the create function; scalar maths on the typed arrays in `step…` and every helper it reaches (same file, or imported from a sibling file of the `sim/` folder). Flagged: `new`, `Array.from`, copying or callback array methods (`map`, `filter`, `slice`, `subarray`, `concat`, `push`, `splice`, `forEach`, `reduce`, `find`, `some`, `every`, …), object and array literals assigned, returned (`return { dx, dy }`), passed as an argument or spread, closures (`=>`), and `vec2`/`sweep` calls. A helper that wraps `nextU32` may build its RNG state tuple (`= [sim.rng[0] …]`); the rest of it, and its callees, are still checked. |
| `sim-module-state` | Module-level values are UPPER_CASE constants only, and nothing writes to an UPPER_CASE container (`NAME[i] =`, `+=`, `++`, `.set(`, `.fill(`, `.push(`); changing values live in the typed arrays. |
| `sim-replay-test` | A test titled with "replay" (log replay) and one with "group", "frames" or "60 vs 120". |
| `stick-table` | The 16 unit vectors in order (1 right, 5 down, 9 left, 13 up), identical to the stick gesture's. |
| `realtime-spec` | A `RealtimeSpec<…>` outside `sim/` (template `<id>-realtime.ts`) and a test titled with "round trip". |
| `loop-lifecycle` | Call `useCanvasLifecycle` wherever `useFixedStepLoop` runs. |
| `loop-no-auto-resume` | Gate the lifecycle on the pause state: the value of `isInterrupted:` inside `useCanvasLifecycle(…)` reads a pause flag (`… || props.isPaused || props.isEnded`; any name containing `paused`/`Paused` that is not a `set…` setter); a hand-written host without `isInterrupted` must read the flag inside `onResume`. |
| `replay-events-timed` | Emit `atMs: tickToMs(tick)` on every change of motion. |
| `replay-capped` | Loop `while bodies move && tick <= maxTicks`. |
| `arena-draw-budget` | A `draw*.test.ts` asserting `toBeLessThanOrEqual(DRAW_CALL_BUDGET)` with every slot in play; budget ≤ 1,000. |
| `arena-golden` | A golden rendering through `paintSimPng` at 390, 1024 and 320 wide, `MOMENTS = [0, 0.5, 1]`, with 9 baselines in `__image_snapshots__/` beside it. |

## Passing output, NOT APPLICABLE and exit 2

- A passing run prints `check-realtime-loop: <n> loop files checked, 0 problems` and `RESULT: PASS`. It
  prints no SKIP lines: a missing prerequisite is a problem that names its owner, because the kit cannot
  compile without it.
- `NOT APPLICABLE: no real-time code: no src/games/<id>/sim folder, no module importing
  src/core/realtime/fixed-step.ts, and no loop kit in src/core/realtime or src/canvas/realtime` (exit 0)
  in an app whose games are all turn-based, or that has no games. The app's own `src/core/geom/` (a
  drawing app's `vec2.ts`) does not count as real-time code; the geometry files are required only once
  real-time code exists.
- Exit 2: the folder has no `package.json` (not an app root), or a configured folder is not
  repo-relative.

## What the heuristic rules cannot see

The checker reads text, not a type-checked program. These limits are deliberate (each would need a
parser to close) and the template and the tests cover them instead:

- `sim-no-alloc` follows helpers in the same file and value imports from sibling files of the same
  `sim/` folder (`import { nearPlayer } from './collide'`). It does not follow helpers imported from
  other folders (`src/core/…`, another game), default or namespace imports, methods called on objects,
  or functions passed as values. **Keep a sim's per-tick helpers in its `sim/` folder** as named
  function declarations or `const f = (…) => { … }`.
- It reports the first allocation per function, not every one; fix it and rerun.
- It does not see allocation hidden in a call (a string built with a template literal, a library
  function that returns an object); the replay and frame-grouping tests do not catch those either, so
  read a new helper's callees once.
- `loop-runner` checks the shape of `run-loop-frame.ts` only; the behaviour is proven by
  `run-loop-frame.test.ts` (one batch per frame, no batch on a quiet frame, recorder once per frame).
- `frame-callback-body` and `loop-no-auto-resume` read the call sites literally: keep the template's
  shape (one `runLoopFrame(…)` statement in the callback, `false` as the second argument, the pause flag
  read in the `isInterrupted:` value on the same line rather than in a variable computed elsewhere under
  a name without `paused`). A setter (`setIsPaused`, `setWasPaused`) does not count as reading the flag.
- `sim-module-state` sees writes to an UPPER_CASE container by its own name in the same file; a write
  through an alias (`const counts = HIT_COUNTS; counts[e] += 1`) or from another file is not seen.
  Keep per-run counters in the sim's typed arrays (a header slot or a buffer), as the template does.

## Troubleshooting

- **`sim-no-alloc` on a helper that only draws a random number:** wrap the draw in a helper that calls
  `nextU32` and builds the state tuple from `sim.rng` (the documented exception), or use `hashU32` for
  per-tick randomness.
- **`sim-no-alloc` on a small vector helper (`return { dx, dy }`):** inline the two scalars, or write the
  result into a scratch slot of a typed array created once in `create…Sim`.
- **`sim-module-state` on a lookup table:** name it UPPER_CASE (`const STICK = [...]`); lower-case
  containers at module level are state.
- **`loop-import-unresolved` for `@/canvas/describe-error`:** the canvas kit is not copied yet; load
  skia-canvas-rendering and copy the canvas kit files it lists.
- **NOT APPLICABLE although a game moves in real time:** its sim is not in `<gamesDir>/<id>/sim/`; move
  it there or pass `--games-dir`.
- **`arena-golden` counts 0 baselines:** the PNGs must sit in `__image_snapshots__/` beside the golden
  test and start with `<game-id>-`.
