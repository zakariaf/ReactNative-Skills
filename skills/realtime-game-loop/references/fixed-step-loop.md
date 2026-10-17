# The fixed-step loop on the UI thread

How a real-time game (an arena chase, a bouncing-orbs dodge) advances its world in fixed ticks on the
UI thread, shows it every frame, and stops safely on iOS and Android. Read this before touching
`src/core/realtime/fixed-step.ts` or anything in `src/canvas/realtime/`.

## Contents

- Why fixed steps on the UI thread
- The accumulator
- The loop runner and hook
- Showing the sim: the real-time canvas host
- Lifecycle, pause and save points (iOS and Android)
- Many sprites
- Refresh rates, simulators, emulators and the frame-time recorder
- What is verified and what is not
- When multi-package

## Why fixed steps on the UI thread

- **Fixed steps:** gameplay advances in ticks of `STEP_MS = 1000 / 120` ms. Results depend on tick
  counts, never on 60, 90 or 120 Hz or on how frames happened to fall, so a recorded run replays
  bit-exactly in Jest, on an iPhone and on an Android phone.
- **UI thread:** the loop runs in a Reanimated frame callback (a worklet), so a busy JavaScript thread
  (a save, a React render, a navigation transition) never stutters the world.
- **No physics engine:** the geometry kit (`src/core/geom/`: vec2, swept circles, a spatial hash)
  covers bouncing, chasing, aiming and ricochets. If a game truly needs stacking, joints or friction,
  the fallback is `planck` on the JS thread (pin it with dependency-management), with replays treated
  as approximate.

## The accumulator

```ts
// src/core/realtime/fixed-step.ts ('worklet')
export const STEP_MS = 1000 / 120;
export const MAX_FRAME_MS = 250;   // longest gap caught up on: background, an interruption, a GC pause

export function planSteps(accMs: number, frameDtMs: number | null): StepPlan {
  const dt = frameDtMs === null ? 0 : Math.min(Math.max(frameDtMs, 0), MAX_FRAME_MS);
  let acc = accMs + dt;
  let steps = 0;
  while (acc >= STEP_MS) { acc -= STEP_MS; steps += 1; }
  return { steps, accMs: acc };
}
```

- `frameDtMs` is `FrameInfo.timeSincePreviousFrame`, which is `null` on the first frame after
  (re)activation: that frame simulates nothing, so a resumed sim never jumps.
- A 120 Hz frame runs one tick, a 60 Hz frame two, a 90 Hz frame runs 1, 1, 2 ticks in turn (4 ticks
  every 3 frames); the remainder
  carries to the next frame. The 250 ms clamp caps catch-up after a stall at 30 ticks.
- `tickToMs(tick)` (same file) turns a tick into whole timeline milliseconds for simulate-then-replay.

## The loop runner and hook

`runLoopFrame(wiring, info.timeSincePreviousFrame)` (`src/canvas/realtime/run-loop-frame.ts`) is the
whole frame-callback body:

1. `wiring.onFrameTime?.(dt)`: the frame-time recorder, when one is wired (see the last section), sees
   every frame, zero-step frames included.
2. `planSteps(accMs, dt)`; store the new `accMs`; return when there are no steps.
3. Read the command once (`command.get()`, an integer written by the stick gesture) and the sim
   (`sim.get()`: on the UI thread this is the live object, not a copy).
4. `step(sim, command)` for each planned tick: the sim mutates its typed arrays in place.
5. `drainEvents(sim)`, then `sim.modify()` so listeners (the picture) re-run: in-place mutation does
   not notify by itself.
6. If there are events, send them to JS once: `scheduleOnRN(onEvents, events)` (sound, HUD, statistics,
   save points). Never one call per event.
7. All of it inside `try/catch`; an error goes to `scheduleOnRN(onError, describeError(error))`, which
   stops the loop and pauses the game (an uncaught UI-thread exception kills the app, and React
   Compiler bails out of a hook whose callback holds value blocks inside `try/catch`, so the `try`
   lives here, not in the hook).

`useFixedStepLoop({ sim, command, game, onEvents, onError, onFrameTime })` owns `accMs`, creates the
frame callback inactive (`useFrameCallback((info) => { runLoopFrame(wiring, info.timeSincePreviousFrame); }, false)`),
keeps it in a ref assigned in an effect (so the error handler can stop it without a temporal-dead-zone
access) and returns `{ start, stop }`; `start` resets the accumulator. The file carries the
`// device-only:` marker (unit-and-component-tests): `run-loop-frame.test.ts` proves its body.

**The frame callback is registered once.** Reanimated's `useFrameCallback` registers the callback again
whenever its identity changes (its effect depends on `[callback, autostart]`), and a newly registered
callback starts with `startTime = null`, so its next frame has no `timeSincePreviousFrame` and
simulates nothing. A game screen that passes state-dependent handlers (a HUD score in `onEvents`) gets a
new handler on every event batch, so each re-render during play would drop one frame of game time:
replays stay exact, but real-time speed drifts. The hook therefore keeps the latest `onEvents` and
`onError` in a ref (assigned in an effect) and puts constant trampolines into the wiring; React Compiler
then memoises the wiring and the callback on stable values only. What stays the caller's job: `game`
is a module constant (a new `step` re-registers) and `onFrameTime` keeps a stable identity (a worklet
over the test-only recorder, below). Verified on 2026-10-14 against react-native-reanimated 4.5.1
(`src/hook/useFrameCallback.ts`: the effect depends on `[callback, autostart]`;
`src/frameCallback/FrameCallbackRegistryUI.ts`: `callback.startTime = null`); re-verify after an
upgrade with `grep -n "callback, autostart" node_modules/react-native-reanimated/src/hook/useFrameCallback.ts`
and `grep -n "startTime = null" node_modules/react-native-reanimated/src/frameCallback/FrameCallbackRegistryUI.ts`.
Not measured on a device.

## Showing the sim: the real-time canvas host

`RealtimeCanvasHost` (`src/canvas/realtime/realtime-canvas-host.tsx`) is the surface of a real-time game:

- `sim = useSharedValue(initialSim)` (the game screen passes `realtime.createSim(state)`, fresh or from a
  save), `command = useSharedValue(0)`, the canvas size from `<Canvas onSize={size}>`, one
  `PictureRecorder` per canvas (`useState`).
- `picture = useDerivedValue(() => recordSim(recorder, { sim: sim.get(), width, height, colors, kit,
  draw, onError }))`: it re-runs whenever the loop calls `sim.modify()`, and `draw` reads the typed
  arrays in place.
- The game's `draw` is a `'worklet'` file in `src/games/<game-id>/canvas/` (template `draw-arena.ts`):
  it paints the background first (`drawColor`: the canvas is opaque, and on Android an opaque canvas is
  a SurfaceView that shows black where nothing was painted), scales the square world to the canvas with
  a margin of one body radius so an edge body is never clipped, sets the kit's scratch paints and draws.
  It allocates no Skia objects and reads no clock (skia-canvas-rendering's drawing rules).
- The input gesture comes in as a builder prop: `makeGesture={makeStickGesture}`
  (canvas-gestures-and-hit-testing), called with the `command` shared value. Build no `Gesture.*` in
  the host.
- The canvas is one accessible image: `accessible`, `accessibilityRole="image"` and a translated
  `accessibilityLabel` (VoiceOver skips a view that is not `accessible`; TalkBack reads the label).

The surface is proven headless. `draw-arena.test.ts` passes a recording `Proxy` canvas and stub paints:
the fullest frame (every entity slot in play) stays within the game's `DRAW_CALL_BUDGET` (never above
1,000), the first call is `drawColor`, and every body lands inside the canvas at three sizes. The pixel
golden (`test/goldens/canvas/<game-id>-arena.golden.test.ts`, the Jest `golden` project, CanvasKit) steps
the sim with a scripted bot to 0, 50 % and 100 % of `RUN_TICKS` and renders it through
`paintSimPng(Skia, { draw, sim, width, height, colors, kit })`, the offscreen twin of `recordSim`, at
390 × 560, 1024 × 700 and 320 × 400 (snapshot ids `<game-id>-arena-<size>-<moment>`, the 0.1 % tolerance
of `skia-golden.ts`). Accept baselines only with `npx jest <file> --selectProjects golden -u` (path first)
after opening every PNG (golden-and-snapshot-tests). Same seed and bot give the same world, so a golden
that varies between runs means the sim or the draw reads time or randomness.

## Lifecycle, pause and save points (iOS and Android)

`useCanvasLifecycle` (skia-canvas-rendering's one lifecycle hook) decides whether a surface may run:
app active AND screen focused AND not covered. The host passes
`isInterrupted: props.isInterrupted || props.isPaused || props.isEnded`, so the pause UI and the result
count as covering the surface:

| Event | What happens |
|---|---|
| A drained batch holds a save-point event (`isSavePoint(events)`, a wave end) | `onSavePoint(sim.get())` (a synchronous JS copy taken between frames), then `onEvents(events)`; the loop keeps running |
| The player taps Pause; the app goes to the background; an interstitial, video or sheet covers the screen; the screen loses focus (navigation, Android back) | `loop.stop()`, `onSavePoint(sim.get())`, `onAutoPause()` (the game screen shows its pause UI) |
| Back to the foreground, the interruption closes, focus returns | nothing: real-time games never auto-resume (`isPaused` is still true) |
| The player taps Resume (`isPaused` false) | `loop.start()` (accumulator reset; the first frame simulates nothing) |
| A batch holds the run's end (death, time up) | one final `onSavePoint(sim.get())` with the final snapshot (game-session-host records the run once from it), then the host sets `isEnded`: `loop.stop()` with no further save point and no pause; the result is shown |

Platform facts the hook builds on (react-components-and-hooks owns `use-is-app-active`):

- **iOS** reports `inactive` for the app switcher, Control Center, a notification banner pulled down
  and an incoming call: the loop pauses there too.
- **Android** reports only `active` and `background`: React Native's `AppStateModule` maps the host
  activity's `onResume` to `active` and its `onPause` to `background`. On Android 10 and newer
  (multi-resume) both apps in split screen or a freeform window stay resumed, so both stay `active` while
  the other window has focus and the game keeps running beside another app. On Android 9 and older
  (API 24–28, still inside React Native 0.86's minSdk) the unfocused window's activity is paused, so
  `AppState` reports `background` and the loop stops. A game that must pause whenever its window loses
  focus also listens to `AppState`'s Android-only `blur` and `focus` events and feeds them into
  `isInterrupted` (documented React Native API; not verified here).
- A system dialog (a permission prompt) shows `inactive` on iOS. On Android it is its own activity, so
  it pauses the game's activity: `AppState` reports `background` (and fires `blur`). On both platforms
  the loop stops, saves and shows the pause UI. Pause the run yourself before asking for a permission
  mid-run, so the pause is deliberate. (The Android half is read from React Native's
  `AppStateModule.kt`, `onHostPause` → `background`; verified on 2026-10-14 against react-native
  0.86.3, re-verify with `grep -n "onHostPause\|APP_STATE_BACKGROUND"
  node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/appstate/AppStateModule.kt`;
  not verified on a device.)

Save points are end of wave, pause, background and blur: never per frame. Save `realtime.snapshot(copy)`
together with the recorded input log, so a restore can also be replayed (sim-design.md). When the host
mounts already paused (a restored run), the lifecycle runs the pause path once: one extra save point,
which is harmless. Everything in gameplay counts ticks, never milliseconds.

## Many sprites

Up to about a hundred bodies: one draw call each in the picture. Hundreds of identical sprites:
pre-render the sprite once per palette set into a sheet and draw them as one atlas call. The host
renders a single `<Picture>`, so draw the atlas inside `draw()`: widen the kit with `MAX_ENTITIES`
`SkRSXform`s built once on JS (`skia.RSXform(1, 0, 0, 0)`) and one source rect per slot (plain
`{ x, y, width, height }` objects); `draw` updates them in place with `xform.set(scale, 0, x, y)` (slots
not in play get scale 0) and calls `canvas.drawAtlas(sheet, srcs, xforms, kit.fill)`. Verified in the
CanvasKit Jest environment inside a recorded Picture, not yet on a device. The declarative
`<Atlas image sprites transforms />` with `useRSXformBuffer` is the alternative when a surface renders it
as a second canvas child. The draw-call budget still applies (≤ 1,000).

## Refresh rates, simulators, emulators and the frame-time recorder

- **iOS:** ProMotion phones run at 120 Hz only while `CADisableMinimumFrameDurationOnPhone` is true;
  Expo's prebuild sets it and skia-canvas-rendering's checker fails an override. Verified on
  2026-10-14 in `@expo/config-plugins` (`build/plugins/withIosBaseMods.js`, the default Info.plist:
  `CADisableMinimumFrameDurationOnPhone: true`); re-verify with
  `grep -n CADisableMinimumFrameDurationOnPhone node_modules/@expo/config-plugins/build/plugins/withIosBaseMods.js`.
  The iOS simulator caps at 60 fps.
- **Android:** the display rate is the device's choice (60, 90, 120 or 144 Hz) and Reanimated's frame
  callback follows the display's vsync; the loop needs no setting, because ticks come from elapsed time.
  Emulators usually render at 60 Hz. Frame statistics:
  `adb -s <serial> shell dumpsys gfxinfo <application-id> framestats` (always name the device).
- A measured note from the source app (iOS simulator only): 31 entities for 10 s at a steady
  115.9 ticks/s while the display ran at 60 fps (target 120). Gameplay is unaffected because it counts
  ticks, but real-time speed must be checked on real phones: if a device runs slow too, compare
  `FrameInfo.timestamp` deltas with wall time before changing `planSteps`.
- A frame-time recorder samples inside `runLoopFrame`'s `try` (the first statement), never from a
  second frame callback, which would keep idle screens rendering. Wire it through the host with
  performance-budgets' `sampleFrame` over the test-only recorder (`actions.frames` from its
  `createPerfDebugActions`, created once, so React Compiler keeps the worklet's identity stable):
  `<RealtimeCanvasHost onFrameTime={(dtMs) => { 'worklet'; sampleFrame(actions.frames, dtMs); }} … />`.
  The recorder exists only at runtime, so a module-level worklet cannot capture it. Leave the prop out in store builds
  (the wiring then holds `null`, and `run-loop-frame.test.ts` proves the recorder sees one sample per
  frame, zero-step frames included). Budget: a hitch rate of at most 10 ms/s over a play test of at
  least 60 s on a 120 Hz phone of each platform (performance-budgets owns the recorder and the budget).

## What is verified and what is not

- Verified in the reference Expo SDK 57 app (Jest, ESLint, TypeScript): `planSteps`, `runLoopFrame`
  (the frame-time recorder sees every frame, zero-step frames included),
  `recordSim`, the host's lifecycle (Skia inert, the loop hook and the foreground hook mocked: the loop
  starts only when runnable; background stops it, saves and shows pause, and it never resumes by
  itself; `isEnded` stops it with no save or pause; a save-point batch is saved before it is handed on),
  replay and frame-grouping determinism, the RealtimeSpec round trip, the draw budget and the nine
  pixel goldens through `paintSimPng`.
- Read from source, not run: the trampolines in `useFixedStepLoop` keep the frame callback registered
  once (Reanimated), and the Android `AppState` mapping of split screen and system dialogs (React Native).
- Verified in the source app on the iOS simulator (Release): typed arrays in a shared value mutated in
  place with `sim.modify()`, events delivered to JS, every frame rendered.
- Not yet run on an Android device or emulator, and not on a 120 Hz phone. The first time a real-time
  game ships, run a Release build on a named iOS simulator and a named Android emulator, confirm the
  picture updates every frame, pause and background stop the loop and resume starts clean, then
  play-test on real phones of both platforms.

## When multi-package

A games monorepo keeps the kit in a package (`packages/play-kit/src/realtime/`, `.../geom/`) and the
host beside the canvas kit, and imports them as `@<org>/play-kit/...`. Run the checker from the repo
root and point it at the folders with `--kit-dir`, `--geom-dir`, `--host-dir` and `--games-dir` (or the
`rn-skills.config.json` keys in checker.md); tsconfig `paths` and package.json `workspaces` resolve the
imports.
