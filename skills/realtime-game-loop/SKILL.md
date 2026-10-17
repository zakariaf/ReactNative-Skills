---
name: realtime-game-loop
description: "Runs real-time play: a fixed-step UI-thread loop, typed-array sims, (tick, command) replays, replayable physics. Use when adding live motion, bouncing balls, a physics shot or a replay test. Not for turn animations (skia-canvas-rendering)."
---

# Real-time game loop

Real-time play advances in fixed ticks of 1/120 s, never in frame time. A real-time game runs a
typed-array sim on the UI thread inside a Reanimated frame callback; a turn-based game with a continuous
phase (a ricochet shot, a cascade) runs that phase inside its pure reducer and replays it as a timeline.
Either way a recorded run replays bit-exactly in Jest, on iOS and on Android. This skill ships the
loop kit (`src/core/realtime/`, `src/core/geom/`), the real-time host (`src/canvas/realtime/`), a
template game (a bouncing-orbs arena) and a checker that proves them.

## Rules that must hold

1. **Simulate in fixed steps of `STEP_MS = 1000 / 120` with a 250 ms catch-up clamp; the first frame
   after (re)activation simulates nothing.** Why: results depend on ticks, never on 60, 90 or 120 Hz or
   frame timing, and a resumed sim never jumps.
2. **Gameplay counts ticks, never milliseconds:** speeds are per tick, timers are tick counts, the sim
   never sees a timestamp. Why: tick counts are exact integers on every device.
3. **Sim state is one plain object of typed arrays in ONE shared value, mutated in place on the UI
   thread, then `sim.modify()`.** Why: no per-frame copies or allocations, and in-place mutation does not
   notify the picture by itself.
4. **A tick allocates nothing:** buffers (entities, events, RNG words, spatial-hash scratch) are created
   once; a full event queue drops edge and hit events but keeps reserved slots so input, save-point and
   run-end events never drop; `step…` and every helper it reaches do scalar maths on the typed arrays
   (`vec2`/`sweep` return new objects and belong to the JS thread). One documented exception: an
   occasional sfc32 draw through a `nextU32` wrapper; per-entity, per-tick randomness uses `hashU32`.
   Why: the loop may run 30 ticks in one frame on the UI thread, garbage collection there is a visible
   hitch, and a lost input breaks the replay.
5. **Sims, the UI-thread kit and real-time draw files are `'worklet'` modules that import values only
   from other `'worklet'` modules.** Why: a plain function called on the UI thread throws at runtime,
   not at build time.
6. **Sims, the kit and simulate-then-replay rules obey the determinism policy:** only `+ - * / %`,
   bitwise, `Math.sqrt/imul/floor/round/abs/min/max/PI`; no `**`, other `Math.*`, `Math.random`, `Date`,
   `performance.now`, `Intl`; randomness from the sim's own sfc32 words. Why: Hermes computes
   transcendental functions with each platform's libm and Jest uses V8, so replays would diverge
   between an iPhone, an Android phone and CI.
7. **Input is an integer command recorded as `(tick, command)`,** from the committed 16-direction table
   (1 right, 5 down, 9 left, 13 up; 0 idle), identical to the stick gesture's table. Why: only integer
   logs replay bit-exactly.
8. **The sim never talks to JS or the app:** it appends `[kind, value, tick]` events; `runLoopFrame`
   drains them once per frame and sends one batch with `scheduleOnRN`; a sim imports nothing from React,
   React Native, Expo, Skia or the app's layers. Why: one crossing per frame, and the sim stays
   testable in plain Jest and reusable by headless bots.
9. **The frame-callback body is one call to `runLoopFrame`, which holds the `try/catch`;** errors stop
   the loop and pause the game. Why: an uncaught UI-thread exception kills the app, and React Compiler
   bails out of hooks with value blocks inside `try/catch`.
10. **The loop runs only while the surface may run** (app active, screen focused, not covered, not
    paused, not ended) through `useCanvasLifecycle`; stopping takes a save point and shows the pause UI;
    real-time games never auto-resume, and resume resets the accumulator. Why: no simulation in the
    background or under an interstitial, and a killed app loses at most the current wave.
11. **Every sim has a replay test and a frame-grouping test.** Why: they are the proof of determinism;
    saves, bots and bug reports all depend on it.
12. **A real-time game exposes a `RealtimeSpec` (createSim, step, drainEvents, snapshot, savePoints,
    isSavePoint) with a tested snapshot round trip, and is saved only at save points.** Why: the host and
    the save path need one contract, a save must restore exactly, and a frame is too short for a write.
13. **Simulate-then-replay games run the continuous phase inside the pure reducer with the same fixed
    step, capped by `maxTicks`, and return timed events (`atMs`).** Why: the game stays turn-based for
    saves, undo, bots and goldens; only the picture moves in real time, and a volley always ends.
14. **A real-time surface is proven like every canvas:** a draw-call budget test with every entity slot
    in play (≤ 1,000), bodies inside the canvas at 3 sizes, and pixel goldens through `paintSimPng` at
    3 sizes × moments 0, 0.5, 1 of a scripted run (9 baselines). Why: the loop's tests prove the numbers,
    not the picture.
15. **No physics engine:** swept circles, `reflect` and the spatial hash; `planck` on the JS thread is the
    documented fallback only for stacking, joints or friction. Why: engines bring non-deterministic
    floats and a second runtime.
16. **Every import of the kit, host, sims and draw files resolves; prerequisites come from their owner
    skills.** Why: a half-copied kit fails at runtime on one screen; the checker names who creates the
    missing file.

## Workflow

1. **Classify the game.** Real-time (an arena chase): read [references/fixed-step-loop.md](references/fixed-step-loop.md)
   and [references/sim-design.md](references/sim-design.md). A continuous phase inside a turn (a shot, a
   drop, a cascade): read [references/simulate-then-replay.md](references/simulate-then-replay.md).
   Geometry: [references/geom-kit.md](references/geom-kit.md). Turn-based only: this skill does not apply
   (game-rules-engine, skia-canvas-rendering).
2. **Check prerequisites.** The templates import `@/core/rng/sfc32` (seeded-determinism-and-golden-vectors;
   a synced copy ships in `templates/src/core/rng/`), the canvas kit's `draw-kit`, `describe-error`,
   `use-canvas-lifecycle` and `test/goldens/skia-golden.ts` (skia-canvas-rendering, golden-and-snapshot-tests;
   canonical `canvas-types`, `canvas-layout` and `timeline/` copies ship in `templates/src/canvas/`),
   `@/hooks/use-is-app-active` (react-components-and-hooks), and fast-check pinned exactly.
3. **Copy the kit.** Run `node ${CLAUDE_SKILL_DIR}/scripts/check-realtime-loop.mjs .` from the repo root.
   For every `loop-file-missing` copy the file verbatim from `templates/` to the path its first line names
   (`templates/src/core/**`, `templates/src/canvas/realtime/**`, tests included). Fix every
   `loop-import-unresolved` with the skill it names.
4. **Real-time game, test-first:** copy `templates/src/games/__GAME_ID__/` to `src/games/<game-id>/`,
   replacing `__GAME_ID__` (kebab), `__GAME_PASCAL__` and `__GAME_CONST__` (UPPER_SNAKE) in names and
   contents. Run the replay, frame-grouping and round-trip tests, then replace the gameplay slot
   (`moveEntity`) with the game's rules, keeping every test green after each change. Add event kinds as
   exported integer constants. Imitate [examples/arena-chase/](examples/arena-chase/).
5. **Its surface and proof:** adapt `canvas/` (palettes with `canvas-contrast.json`, `draw-arena.ts`, the
   budget test; skia-canvas-rendering's palette and contrast rules apply) and copy
   `templates/test/goldens/canvas/__GAME_ID__-arena.golden.test.ts`. Create the baselines deliberately:
   `npx jest test/goldens/canvas/<game-id>-arena.golden.test.ts --selectProjects golden -u`, open all 9
   PNGs (bodies inside the canvas, nothing clipped at `small`), then `CI=1 npx jest --ci --selectProjects golden`;
   commit the baselines with a `Gate-Change:` trailer (golden-and-snapshot-tests).
6. **Wire the board into the host** (game-session-host owns the Game screen, the run store and the
   writes): the game's `Surface` receives `GameSurfaceProps` and renders `RealtimeCanvasHost` with
   `initialSim={realtime.createSim(props.state)}`, `game={realtime}`, `draw`, `colors` and `kit`
   (makeCanvasColors, makeDrawKit), `makeGesture={makeStickGesture}`, `onEvents` (sounds, HUD,
   statistics, input log), `isSavePoint={realtime.isSavePoint}`, `onSavePoint={(copy) =>
   props.onSavePoint(realtime.snapshot(copy), inputLog)}` (every save point and one final one at the
   run's end), `isEnded={props.isEnded}`, `isPaused={!props.isInputEnabled && !props.isEnded}`,
   `onAutoPause` (a no-op inside a hosted Surface: the Game screen already pauses on background, blur
   and full-screen ads), `isFocused` (`useIsFocused()` from expo-router; React Navigation 7:
   `@react-navigation/native`), `isInterrupted`, `onFailure`, a translated label, and in measurement
   builds `onFrameTime` (performance-budgets' `sampleFrame` worklet). Keep `game` a module
   constant; the host keeps the JS callbacks behind stable trampolines. Join the spec to
   the module: `GameModule<…> & { realtime }` with `savePolicy: { kind: 'save-points', points }`.
7. **Simulate-then-replay game:** imitate [examples/ricochet-volley/](examples/ricochet-volley/): a pure
   `simulate…` function in `src/games/<game-id>/rules/` called by `applyMove`, events with
   `atMs: tickToMs(tick)`, a `maxTicks` cap, a tracks builder in the surface folder, and the property tests.
8. **Lint, format, type-check and test:** `npx eslint --fix src/games/<game-id> src/core/realtime src/core/geom src/canvas/realtime`,
   `npx prettier --write` on them, `npm run typecheck`, then
   `npx jest src/games/<game-id> src/core/realtime src/core/geom src/canvas/realtime --ci --selectProjects unit`
   (paths first: `--selectProjects` takes several values and would swallow them).
9. **Run the check** `node ${CLAUDE_SKILL_DIR}/scripts/check-realtime-loop.mjs .`; fix every `FAIL` line
   (file, rule, fix) and rerun until `RESULT: PASS`. Options, config keys and every rule:
   [references/checker.md](references/checker.md).
10. **Play it for real.** The host is unit-tested with Skia inert and the loop mocked; it has not run on
    an Android device yet. On the first real-time game, run a Release build on a named iOS simulator
    (ios-simulator-build) and a named Android emulator (android-emulator-build): the picture updates
    every frame, pause, background and Android back stop the loop, resume starts clean. Then a human
    plays at least 60 s on a 120 Hz phone of each platform with the frame-time recorder passed as the
    host's `onFrameTime` (hitch rate ≤ 10 ms/s, performance-budgets) and judges the feel.

## Definition of done

- [ ] The kit exists with its tests: `src/core/realtime/{fixed-step,replay-commands,realtime-spec}.ts`,
      `src/core/geom/{vec2,sweep,spatial-hash}.ts`; for a real-time game also `src/canvas/realtime/`
      (`run-loop-frame`, `use-fixed-step-loop`, `record-sim`, `paint-sim-png`, `realtime-canvas-host`).
- [ ] Each sim is a `'worklet'` module of typed arrays that allocates nothing per tick, counts ticks,
      records `(tick, command)`, drains `[kind, value, tick]` events, and its replay and frame-grouping
      tests pass; its `RealtimeSpec` round-trip test passes.
- [ ] Each real-time surface has light and dark palettes with `canvas-contrast.json`, a `'worklet'`
      draw, a draw-call budget test (≤ 1,000) and 9 reviewed golden PNGs that pass under
      `CI=1 npx jest --ci --selectProjects golden`.
- [ ] Each simulate-then-replay phase is pure, capped by `maxTicks`, emits `atMs` events, and its
      properties (inside the arena, never faster, deterministic, tracks replay the path) pass.
- [ ] The host stops the loop, saves and shows the pause UI on pause, background, blur and
      interruptions, and never auto-resumes.
- [ ] `npm run typecheck`, `npx eslint --max-warnings 0` and `npx prettier --check` pass on the new
      files; no `__GAME_…__` placeholder is left.
- [ ] `node ${CLAUDE_SKILL_DIR}/scripts/check-realtime-loop.mjs .` prints `RESULT: PASS`

The checker prints no SKIP lines. It prints `NOT APPLICABLE: no real-time code: …` (a pass) in an app
whose games are all turn-based, and stops with exit 2 in a folder without `package.json`.

## Anti-patterns

- **Moving entities by `dt` in milliseconds** (`x += speed * dt`). Frame timing leaks into gameplay and
  replays diverge; move per tick inside `step`.
- **Keeping the world in React state or copying it to JS every frame.** Keep it in the shared value; JS
  gets batched events and a copy only at save points.
- **Angles and `Math.atan2`/`Math.cos` in the sim.** Use committed unit-vector tables, dot products and
  `reflect`.
- **Calling `scheduleOnRN` from inside the sim, or once per event.** Queue events in the sim; the runner
  sends one batch per frame.
- **Growing arrays per tick** (`events.push` on a JS array, `new Float32Array`, `.map`). Pre-allocate
  and write in place.
- **A module-level `let` or array in a sim file** (a counter, a hit log). The UI thread works on its own
  captured copy, and saves and replays never see it; keep every changing value in the typed arrays.
- **Passing a stride-4 `body` array to the spatial hash** (it expects stride 2). Wrong cells, no error.
- **Auto-resuming a real-time game** when the app returns to the foreground or an interstitial closes.
  The player expects the pause UI; resume only on their tap.
- **Running a volley live in the frame loop instead of inside `applyMove`.** It breaks saves, undo, bots
  and goldens; simulate first, then replay the events.
- **A second frame callback for measurements.** The frame-time recorder goes in through the host's
  `onFrameTime` and is sampled as the first statement of `runLoopFrame`'s `try`; an extra callback keeps
  idle screens rendering.
- **Saving every frame or every tick.** Save at wave ends, pause, background and blur only.
- **Trusting the simulator or emulator for speed.** The iOS simulator caps at 60 fps and emulators
  usually render at 60 Hz; judge feel and hitch rate on real 120 Hz phones.

## Files in this skill

| File | What it is | Read/run when |
|---|---|---|
| [references/fixed-step-loop.md](references/fixed-step-loop.md) | The accumulator, runner and hook, the real-time host, lifecycle and save points on iOS and Android, sprites, refresh rates, what is verified, multi-package | Workflow step 1 for real-time games, and before touching the loop |
| [references/sim-design.md](references/sim-design.md) | Typed-array state, one tick, events, sfc32 words, the determinism policy, integer commands, replay tests, save points, the RealtimeSpec | Steps 1 and 4 |
| [references/simulate-then-replay.md](references/simulate-then-replay.md) | Continuous phases inside `applyMove`: fixed step, timed events, tracks, the collision recipe, discrete runs, tests | Steps 1 and 7 |
| [references/geom-kit.md](references/geom-kit.md) | `vec2`, `sweep`, `spatial-hash` APIs and rules for new geometry | Whenever a game needs vectors or collisions |
| [references/checker.md](references/checker.md) | The checker's options, config keys, discovery, every rule with its fix, NOT APPLICABLE, troubleshooting | Step 9, when a line is unclear or folders differ |
| `templates/src/core/realtime/` | `fixed-step.ts`, `replay-commands.ts` (each + test), `realtime-spec.ts` | Step 3 (copy verbatim) |
| `templates/src/core/geom/` | `vec2.ts`, `sweep.ts`, `spatial-hash.ts`, each with its test | Step 3 (copy verbatim) |
| `templates/src/canvas/realtime/` | `run-loop-frame.ts` (+ test), `use-fixed-step-loop.ts`, `record-sim.ts` (+ test), `paint-sim-png.ts`, `realtime-canvas-host.tsx` (+ lifecycle test) | Step 3 (copy verbatim) for a real-time game |
| `templates/src/canvas/` (other files) | `canvas-layout.ts` (+ test), `canvas-types.ts`, `timeline/track.ts`, `timeline/sample.ts` (+ test): synced canonical copies (skia-canvas-rendering owns them); keep the app's copy | Step 2, only when the app lacks them |
| `templates/src/core/rng/` | `sfc32.ts` and its golden test: synced canonical copy (seeded-determinism-and-golden-vectors owns it) | Step 2, only when the app lacks it |
| `templates/src/games/__GAME_ID__/` | The template game: `sim/` (sim + replay tests), `<id>-realtime.ts` (RealtimeSpec + round-trip test), `canvas/` (palettes, contrast pairs, draw, budget test) | Steps 4 and 5 |
| `templates/test/goldens/canvas/` | `__GAME_ID__-arena.golden.test.ts` and its nine reviewed baselines in `__image_snapshots__/` | Step 5 |
| [examples/arena-chase/](examples/arena-chase/) | A chase sim (player, chasers, hits) with its replay tests: the shape of real gameplay in a sim | Step 4 |
| [examples/ricochet-volley/](examples/ricochet-volley/) | Simulate-then-replay volley with sweep and reflect, its property tests, and the tracks builder with its test (one piece of the game's surface; skia-canvas-rendering builds the rest) | Step 7 |
| `scripts/check-realtime-loop.mjs` | The checker (21 rules; references/checker.md) | Steps 3 and 9 and at the end |
| `scripts/selftest.mjs` | Proves the checker passes the templates and examples and catches each planted bug | After changing the checker, a template or an example |
| `scripts/lib/source-scan.mjs` | Synced source helpers (worklet directive, imports, resolution); do not edit here | When changing the checker |
| `scripts/check-lib.mjs` | Shared script library, synced (do not edit here) | Never by hand |
| `assets/shared.json` | Declares the synced files | When adding a shared file |
| `assets/template-placeholders.json` | The values the self-test and template verification fill in (`bounce-arena`) | When adding a placeholder |
| `tests/bases/app/` | The fixture base under the templates: `package.json`, `tsconfig.json` and stand-ins for two canvas kit files | When the fixture base changes |
| `tests/fixtures/` | `check-realtime-loop/`: `good/` (templates + ricochet example), one `bad-*` per planted bug, `pass-*` (turn-based app, config folder, installed skills, an RNG draw in the tick, a destructured frame callback with a renamed pause flag) and `error-*` | When adding a rule to the checker |

## Related skills

- `skia-canvas-rendering` - drawing rules, palettes, the canvas kit and lifecycle, turn timelines that replay simulate-then-replay events.
- `canvas-gestures-and-hit-testing` - the stick gesture that writes integer commands, and aim intents.
- `game-rules-engine` - `applyMove`, events, the game module and `SavePoint`.
- `seeded-determinism-and-golden-vectors` - the determinism policy and the sfc32 PRNG.
- `game-session-host` - the game screen: pause UI, save points, HUD from events, results.
- `game-balance-and-bots` - thousands of seeded headless runs of the same `step`.
- `golden-and-snapshot-tests` - the golden policy and accepting baselines.
- `audio-and-haptics-feedback` - drained events become sounds and haptics on JS.
- `performance-budgets` - the frame-time recorder and the on-device hitch-rate budget.
- `ios-simulator-build` and `android-emulator-build` - the Release builds of step 10.
