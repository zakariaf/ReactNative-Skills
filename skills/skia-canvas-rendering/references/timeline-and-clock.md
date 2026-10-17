# Timeline, frame clock, presenter and lifecycle

How a committed change becomes a short animation, and how the clock that plays it starts, stops
and survives restarts. Read this before writing `buildTimeline` or touching `scene.ts`,
`scene-clock-state.ts`, `run-scene-frame.ts`, `use-scene-clock.ts`, `present-change.ts`,
`cue-scheduler.ts`, `use-canvas-lifecycle.ts` or `use-surface-player.ts`.

## Contents

- Tracks and easing
- Sampling rules
- Writing buildTimeline
- The frame clock and the startAt fix
- The clock's decisions: scene-clock-state
- Case study: the frozen surface after an interruption
- Presenting a change: persist first, fast-forward or queue
- When the data comes from the server (TanStack Query)
- Cues: sound and haptics on the timeline
- Stopping: idle, background, overlays, focus (iOS and Android)
- The clock trace and the canvas-frame probe (debug builds)
- 120 Hz on iOS, refresh rate on Android
- Never an endless clock
- The frame-time hook

## Tracks and easing

A `Track` is pure data: "entity 1003's `flip` channel goes from -1 to 1 between 50 ms and 250 ms,
easing in-out, and when it starts play `complete` with a light haptic".

```ts
export type Track = {
  readonly channel: string;          // 'flip', 'glow', 'burst', 'bar', 'flash' ...
  readonly entityId: number;         // an item id, or a cell id from canvas-ids.ts
  readonly startMs: number;
  readonly durationMs: number;
  readonly easing: EasingId;         // 'linear' | 'in-quad' | 'out-quad' | 'in-out-quad' | 'out-cubic' | 'out-back'
  readonly from: readonly number[];  // equal-length number vectors, interpolated per component
  readonly to: readonly number[];
  readonly cue?: TrackCue;           // { sound?: string; haptic?: HapticCue } fired when the track starts
};
export type Motion = 'full' | 'reduced';
```

- Easings are polynomials only (`+ - *`), so they replay identically in Jest, Node and on device.
- `timelineEndMs(tracks)` is the latest `startMs + durationMs`: the scene is done at that time.
- Channel names belong to the surface; keep them short and list them at the top of `build-timeline.ts`.

## Sampling rules

`sampleTimeline(tracks, elapsedMs)` samples every `(channel, entity)` key once:

- **Before a key's first track starts**, the key holds that track's `from` (a bar keeps its old
  height until its tween begins).
- **Several tracks on one key**: the latest started wins; if none started, the earliest unstarted
  one. So a chain of moves is several sequential tracks on one entity.
- **After the end**, the key holds `to` exactly, with `progress` 1 and `ageMs` = duration.
- `fxEntry(fx, channel, id)` returns `undefined` when there is no track: draw the view's final state.
- Each entry has `values`, eased `progress` (0…1) and `ageMs` (clamped to 0…duration).
- **So an entry exists before its track has started.** A tween of something already visible may use
  the held `from`. An effect that only exists while it plays (flash, glow, burst, shake) draws only
  when `isPlaying(entry)` (`ageMs > 0 && progress < 1`), or it shows at full strength at moment 0.

## Writing buildTimeline

`buildTimeline(events, motion)` is pure: the same events always give the same tracks.

1. One small function per event kind returning `Track[]`, dispatched by an exhaustive
   `switch (event.kind)`.
2. Beat start times as named constants (the template's `FOLLOW_DELAY_MS`, `GOAL_AT_MS`), so a change
   reads as a score.
3. `const timing = { scale: motion === 'full' ? 1 : 0.5, isFull: motion === 'full' }`; under
   `'reduced'` halve durations, drop particle (`burst`) and shake tracks, and use `'linear'` instead of
   `'out-back'` (no overshoot). The screen passes the live reduce-motion value (accessibility-as-code's
   `useReduceMotion`, which follows the OS setting and the app's own setting); never Reanimated's
   `useReducedMotion()`, which reads the setting once when the app starts.
4. Things that vanish get a track that carries their position (they are no longer in the view).
5. Put the sound and haptic on the track that starts the beat (the template's first `flip` track
   carries `{ sound: 'complete', haptic: 'light' }`).
6. Events are past tense and carry every id and from/to value the animation needs: never go back to
   the store to find out what happened.

Tests (template `build-timeline.test.ts`): the busiest change stays within `CHANGE_BUDGET_MS`
(1200 ms default), reduced motion has no `burst`, no `out-back` and is shorter, the cues are right,
and the output is deterministic.

## The frame clock and the startAt fix

The bug in the first design: the clock wrote `now = frameInfo.timeSinceFirstFrame`, JS stored
`t0 = now`, and the callback was stopped when idle. Reanimated 4.5.1 sets `startTime = null` whenever
a frame callback is deactivated (`FrameCallbackRegistryUI.ts`), so after a restart
`timeSinceFirstFrame` begins at 0 again while `t0` held the old value: every animation after the first
started at a negative elapsed time and froze. Using `timestamp` alone is also wrong (a stopped clock
leaves `now` stale).

The fix is a sentinel:

- JS pushes `makeScene(seq, view, tracks)`, whose `startAt` is `NOT_STARTED` (-1).
- `runSceneFrame` (the whole frame-callback body) calls `tickClock(scene, info.timestamp)`: on the
  first frame it stamps `startAt = timestamp`, and `elapsed = timestamp − startAt` from then on. It
  writes `now`, and when `elapsed ≥ endMs` it sends `onDone(run, seq)` to JS with `scheduleOnRN`.
- The picture draws `sceneElapsedMs(scene, now)`: 0 while `startAt` is still the sentinel, so a
  just-pushed scene shows its first frame.
- `useSceneClock` creates one clock driver per surface (`useState`), which holds the JS side's record
  (`ClockControl`) and reaches the `FrameCallback` through `connect(...)` in an effect: `onDone` needs
  `frame.setActive(false)`, but `frame` is created from a callback that references `onDone` (a direct
  reference is a temporal-dead-zone error the React hooks lint reports).
- The frame callback body is one call, `runSceneFrame(wiring, info.timestamp, info.timeSincePreviousFrame)`,
  which wraps its work in `try/catch` and reports errors with `scheduleOnRN(onError, describeError(error))`.
  React Compiler bails out of memoising a hook whose inline callback has `?.` or ternaries inside
  `try/catch`, and an uncaught exception on the UI thread kills the app.

Verified in the source app on an iOS simulator (Release build): eight consecutive scenes, each stopped
and restarted, all started at elapsed 0; a 720 ms timeline ran 45 frames at the simulator's 60 fps cap,
one frame past its end, then the clock stopped itself. `scene.test.ts` replays fake `FrameInfo`
sequences in which `timeSinceFirstFrame` restarts at 0 after every activation. Re-verify the reset when
Reanimated moves: read `src/frameCallback/FrameCallbackRegistryUI.ts` of the installed version (the
sentinel fix works either way).

## The clock's decisions: scene-clock-state

`scene-clock-state.ts` (a `'worklet'` module with no Reanimated import, so Jest replays traces through
it) holds every decision; `useSceneClock`'s driver applies each step and is the one place that calls
`setActive`:

| JS call | Step | Effect |
|---|---|---|
| `push(scene)` (a committed change) | `pushScene` | new `run`; the scene (always `startAt` `NOT_STARTED`) plays at once while the surface is runnable, and is **held** while it is not (backgrounded, unfocused, covered): it starts on the first frame after the surface is runnable again, so the animation plays when someone can see it |
| `stop()` (lifecycle `onPause`) | `stopClock` | new `run`, not runnable, callback off: every `done` already on its way is void |
| `resume()` (lifecycle `onResume`) | `resumeClock` | new `run`, runnable, callback **always** on, even when the scene has ended: at least one frame is recorded after the surface is visible again, so the canvas never keeps a picture recorded while it was covered; an interrupted timeline jumps to its end, a held scene starts |
| `onDone(run, seq)` (from the UI) | `finishRun` | stops only when `run` is the current run; anything else is stale and changes nothing |
| `onError(message)` | `haltClock` | callback off until the next push or resume; the screen reports the error |

Before every `setActive(true)` the driver writes the new run into the `run` shared value, so the frame
that starts names the run it belongs to. The invariant, proven by `scene-clock-state.test.ts` and by
`scene-clock-traces.test.ts`: (1) a scene pushed while the surface may not run is held with `startAt`
`NOT_STARTED` and starts on the first frame after it may; (2) every return to runnable records at least
one frame; (3) a stale `onDone` never stops a newer scene. `check-canvas-code.mjs` rule `clock-runnable`
fails a `use-scene-clock.ts` that does not route push, stop, resume and done through these functions,
switches the callback with a literal `setActive(true|false)`, or reads `scene.get()` on the JS thread.

## Case study: the frozen surface after an interruption

Symptom (seen in the source app, reproduced on an iOS simulator in a Release build): a full-screen
overlay covers the surface; the user closes it, and the app immediately commits a follow-up change.
The data is right, but the picture stays on the first frame of the new animation until the next
change: a screenshot five seconds later is byte-identical, and the canvas-frame probe reads
`{"seq":2,"settled":false}` for good. The same change without the overlay animates in full.

The recorded clock trace (milliseconds since the first entry, `run` is the clock's run token):

| Interrupted | Uninterrupted, same data |
|---|---|
| `9153 push seq 1`, frame, `done seq 1` (clock off) | `9377 push seq 1`, frame, `done seq 1` (clock off) |
| `18462 stop` (the overlay covers the surface; the app stays active and the screen stays focused) | (no overlay) |
| `84740 resume` (run 4, scene seq 1, long ended) | |
| `84761 push run 5 seq 2 end 540` (the follow-up change, 21 ms after the resume) | `18472 push run 4 seq 2 end 540` |
| `84763 frame run 4 seq 1 elapsed 75566`: the UI ran the resume's frame before it applied the push | frames of run 4, seq 2: elapsed 0, 100 ... 517, 550 |
| `84764 done seq 1`: the hook compared 1 with a JS read of `scene.get().seq`, which still returned **1**, and stopped the clock | `done seq 2` at elapsed 550: the clock stops after the end |
| no frame for seq 2 ever: the picture keeps `sceneElapsedMs = 0` of the new scene | `settled: true` |

**Cause: the clock was stopped while the new scene was unfinished, by a stale `onDone`.** The resume
starts a frame for the old scene; the new scene is pushed 21 ms later; the UI's frame for the old scene
reports done; and the hook guarded itself with `seq === scene.get().seq`, a JS read that returns the JS
thread's cached copy until the UI thread has applied the newest write (verified on Reanimated 4.5.1),
so the stale done matched and stopped the new scene before its first frame. The uninterrupted change
has no resume right before its push, so no stale done is in flight. Frames simply stopped; the canvas
itself was fine.

**The fix (these templates): the run token.** `finishRun` compares the done message's run with the JS
record's run, never a shared value read back on JS. On the fixed build the same steps read
`resume run 5 seq 1`, `push run 6 seq 2`, `frame run 5 seq 1`, `done run 5 isStale true` (ignored),
then `frame run 6 seq 2 elapsed 0` ... `elapsed 591`, `done run 6`, and the probe reads
`{"seq":2,"settled":true}`. Going home in the middle of an animation and reopening the app 7 s later
gives one frame at resume and `settled: true`. `scene-clock-traces.test.ts` replays both traces: the
seq-guard hook freezes, `scene-clock-state` does not.

## Presenting a change: persist first, fast-forward or queue

`useSurfacePlayer` receives the latest `CommittedChange { seq, state, events }` (already applied and
persisted: from the store, or from `useCommittedChange` for server data) and calls `presentChange`:

1. `cues.cancel()`: drop the previous change's unfired sounds and haptics.
2. `tracks = buildTimeline(events, motion)`.
3. `clock.push(makeScene(seq, toView(state), tracks))`: the new scene replaces a running one. Because
   the view is the final state, that is a clean fast-forward.
4. `cues.schedule(tracks)`.

Input policy per surface: **fast-forward** (default: a change arriving mid-animation replaces the
scene) or **queue** (only when the animation carries information the user needs before the next
input: the screen waits for `isSceneAnimating(scene, now) === false` before accepting input).

**A surface animates only changes committed while it is mounted.** The store keeps its latest
`CommittedChange` across screens, so a stack screen pushed again mounts with the change it showed last
time. `useSurfacePlayer` seeds the clock with that change's final view (no tracks) and remembers its
`seq`; only a change with another `seq` is presented. Without this, every visit to the screen
replayed the last flip, glow and burst with their sounds and haptics (a "goal reached" celebration
each time Insights opens). `use-surface-player.test.ts` proves that the change present at mount pushes
no tracks and schedules no cues, and that a later `seq` animates. The store never needs to clear its
events for this.

## When the data comes from the server (TanStack Query)

Charts are the typical Skia surface, and their data usually arrives through TanStack Query over the
app's `ApiClient` (`networking-and-server-state` owns the queries and their keys). There is no reducer
that returns events, so the pieces map like this:

| Local store | Server data |
|---|---|
| the reducer returns `{ state, events }` | `diffEvents(previous, next)` in the surface folder derives the past-tense events from two states: pure and tested (the example's `diff-events.ts`) |
| the store's counter is the `seq` | `useCommittedChange(data, diffEvents)` (the kit's `use-committed-change.ts`) gives each new data identity the next `seq` |
| apply and persist, then present | the query cache already holds the state when the hook sees it; for a surface that is "persisted" |
| an undo is a new change | an optimistic update and its rollback are two changes: the bars move forward, then back |

```ts
// use-insights-model.ts (the only code that reads queries, per the feature layout)
const { data } = useQuery({ queryKey: insightsKeys.week(weekOf), queryFn: () => api.week(weekOf) });
const change = useCommittedChange(data, diffEvents); // null until the first data
// null: the screen shows its loading state; otherwise <SurfaceHost change={change} ... />
```

- **The first data is shown, never animated:** `useCommittedChange` gives it no events, and the
  player shows the change present at mount without tracks. A chart does not grow from nothing on every
  screen open.
- **Identical refetches replay nothing.** TanStack Query keeps the previous data reference when a
  refetch returns deep-equal data (structural sharing, `structuralSharing` defaults to `true`), and the
  same `replaceData` runs for `setQueryData` and for `select` results: `queryObserver.ts` runs
  `data = options.select(data)` and then `replaceData(prevResult?.data, data, options)`, so even an
  inline `select` that builds new, deep-equal plain objects on every render keeps its previous
  reference (verified on 2026-10-03 by reading `@tanstack/query-core` 5.104.0). The hook sees the same
  identity and commits nothing. Two things break it: `structuralSharing: false`, and data that
  `replaceEqualDeep` cannot share. It shares only plain arrays and plain objects, so a `Date`, `Map`,
  `Set` or class instance in the query data or in a `select` result is new on every refetch, and so is
  every object that contains it. Keep structural sharing on and keep both plain JSON (dates as
  date-key or ISO strings, parsed in `toView`).
- **Optimistic updates:** `onMutate` writes the cache with `setQueryData` (a change: the bar tweens up),
  `onError` writes the snapshot back (the next change: `diffEvents` derives the reverse event and the
  bar tweens down), `onSettled` invalidates; a refetch that returns what the cache already holds
  commits nothing.
- **Several facts at once:** a refetch may bring a day changed on another device and a new week;
  `diffEvents` returns every event in one change and `buildTimeline` plays them as one score.
- **Tests:** `diff-events.test.ts` beside the surface pins each case (a changed day, an equal state, a
  new week, a rollback); `use-committed-change.test.ts` in the kit pins the identity rules (null while
  loading, first data without events, a kept identity commits nothing, optimistic and rollback are two
  changes).

## Cues: sound and haptics on the timeline

`createCueScheduler(audio, haptics)`: sounds go to `audio.play(id, startMs)` (scheduled on the audio
clock), haptics fire at once for `startMs <= 0` and through `setTimeout(…, startMs)` otherwise;
`cancel()` clears the timers and calls `audio.cancelPending()`. The ports belong to
`audio-and-haptics-feedback`; the scheduler types them structurally (`CueAudio`, `CueHaptics`), so
that skill's ports fit as they are and a silent surface passes nothing (`useSurfacePlayer` then uses
no-op ports).

## Stopping: idle, background, overlays, focus (iOS and Android)

`useCanvasLifecycle({ isFocused, isInterrupted, onPause, onResume })` is the one place that decides
whether a surface may run: app active (`useIsAppActive` from `@/hooks/use-is-app-active`, the shared `AppState` hook), the screen focused
(`useIsFocused()` from expo-router; React Navigation 7: `@react-navigation/native`) and nothing
full-screen covering it (`isInterrupted`).

| Event | Timeline surface | Live surface |
|---|---|---|
| Timeline ends | the clock stops itself (`onDone`) | n/a |
| Background, blur, overlay | `clock.stop()`, `cues.cancel()`, `audio.suspend()` | stop the loop, save, show a paused state |
| A change committed while not runnable | held (`pushScene`): its first frame comes after the surface is visible again | n/a |
| Back to runnable | `audio.resume()`, `clock.resume()`: at least one frame; an interrupted timeline finishes, a held scene starts | stays paused until the user resumes |

`audio.suspend()` / `resume()` return promises: handle them with `.catch(reportError)`, never with an
async handler.

- **iOS:** `AppState` reports `inactive` for the app switcher, Control Center and incoming calls,
  then `background`. A modal presented over the screen, a full-screen video or an interstitial does
  not background the app and does not blur a screen that stays mounted under it, so the only fact that
  changes is `isInterrupted`: set it from whatever shows the overlay.
- **Android:** `AppState` has only `active` and `background` (there is no `inactive`). An overlay
  that is a separate Activity (most full-screen ads, some system pickers) moves the app to `background`
  through the Activity lifecycle; an overlay drawn inside the app's own Activity (a React Native modal)
  changes nothing but `isInterrupted`. With predictive back enabled
  (`android.predictiveBackGestureEnabled: true` in the Expo config, as the SDK 57 template sets it),
  the previous screen is visible during the back gesture before focus changes. These Android facts come from React Native's and
  Android's documentation; verify them on a named emulator (`adb -s <serial>`) before relying on them.

`useCanvasLifecycle` also reports the three facts (`onFlags`) before it decides, which the clock trace
records as `runnable` entries.

## The clock trace and the canvas-frame probe (debug builds)

Pass `traceClock` to `useSurfacePlayer` (or `SurfaceHost`) in debug builds only (development or
preview variants with a debug switch on; production passes nothing): it receives one entry per clock
event, labelled `push`, `stop`, `resume`, `frame`, `done` or `runnable`, with
`{ seq, startAt, elapsedMs, endMs, run, isAppActive, isFocused, isInterrupted }` (`done` adds
`isStale`). UI-thread frames are sampled for 2 s after each run's first frame (`traceFrameStep`: the
first frame, one every 100 ms and the frame that ends the scene) and reach JS through `scheduleOnRN`.
Write them wherever the app keeps debug logs (`debug-menu-and-test-hooks` owns the switches); a frozen
picture is then diagnosed from the trace, as in the case study above.

`SurfaceHost`'s `probe={{ testIdPrefix: 'tasks' }}` renders `CanvasLayoutProbe`, which also publishes
`tasks.canvas-frame` = `{"seq":<n>,"settled":<b>}`, computed on the UI thread by `sceneFrameOf(scene, now)`
from the values the picture is recorded from (`settled`: the picture was recorded at or after the
scene's end). It changes only when `seq` or `settled` changes. A Maestro flow waits for it after a
change (`extendedWaitUntil: visible: { id: 'tasks.canvas-frame', text: '.*"settled":true.*' }`);
`e2e-maestro` owns the flows.

## 120 Hz on iOS, refresh rate on Android

- **iOS:** `CADisableMinimumFrameDurationOnPhone = true` in the app's `Info.plist` lifts the 60 fps cap
  on ProMotion iPhones; Reanimated 4.5.1 already asks `CADisplayLink` for 120 fps, and the key is the
  only switch. **Expo's prebuild template already sets it**, so a Continuous Native Generation app
  writes nothing. Verified on 2026-10-03: `expo-template-bare-minimum` 57.0.28 has the key `true` in
  `ios/HelloWorld/Info.plist`, `@expo/config-plugins` 57.0.9 (`withIosBaseMods`) has it in its default
  Info.plist, and `npx expo prebuild --platform ios --no-install` in the reference app, whose
  `app.config.ts` does not mention the key, wrote `<key>CADisableMinimumFrameDurationOnPhone</key>
  <true/>` into `ios/<App>/Info.plist`. (`npx expo config --type introspect` reports `true` with or
  without a key in the config, so it proves nothing either way.) What breaks it: an
  `ios.infoPlist.CADisableMinimumFrameDurationOnPhone: false` in the config, a config plugin that sets
  it to `false` or deletes it, or committed native folders (the fenced bare alternative) whose
  `ios/<App>/Info.plist` lacks it. `check-canvas-files.mjs` rule `plist-120hz` reads the config, every
  local file it references and any file under `plugins/`, and the `Info.plist` beside each
  `ios/<App>.xcodeproj` when an `ios/` folder exists. Re-verify when Expo moves:
  `npm pack expo-template-bare-minimum@<sdk> && tar -xOzf expo-template-bare-minimum-*.tgz package/ios/HelloWorld/Info.plist | grep -A1 CADisableMinimumFrameDurationOnPhone`,
  or run `npx expo prebuild --platform ios --no-install` in a scratch copy of the
  app and read `ios/<App>/Info.plist`.
- **Android:** no key. Frame callbacks follow `Choreographer`, which runs at the display's current
  rate (60, 90 or 120 Hz, chosen by the system and the device's power settings). Confirm on a
  high-refresh device with Developer options › Show refresh rate, or
  `adb -s <serial> shell dumpsys gfxinfo <package> framestats`. (From Android's documentation; not
  verified on a device for this skill.)
- Simulators and emulators are not devices: the iOS simulator caps at 60 fps. The developer confirms
  120 Hz and the hitch rate on a real ProMotion iPhone and a high-refresh Android phone with a
  frame-time recorder (`performance-budgets`). Animation time always comes from timestamps, so 60 and
  120 Hz play the same timeline.

## Never an endless clock

Skia's `useClock()` registers a Reanimated frame callback that runs on every frame for as long as the
component is mounted and writes `timeSinceFirstFrame` (Skia 2.6.2's
`src/external/reanimated/interpolators.ts`); `withRepeat(animation, -1)` never ends either. Both keep the
display link busy and the picture re-recording while nothing changes, for as long as the canvas is
mounted: on an idle screen, on an unfocused screen that a stack keeps mounted, under a modal or an
overlay, all outside `useCanvasLifecycle`. (The background is not the cost: Reanimated 4.5.1 stops its
Choreographer callback when the Android activity pauses, and iOS delivers no display-link frames to a
backgrounded app; read in the sources, not measured.) `check-canvas-code.mjs` rule `idle-clock` fails
either call in the kit, in a surface folder and in a Skia file that renders no `<Canvas>` (a hook that
feeds one elsewhere); in any other `.tsx` file it fails only a call whose value reaches one of the
file's `<Canvas>` elements, by the name it is bound to or a value derived from it, because the same
file may animate an ordinary view (that view's loop is `motion-and-animation`'s concern). A pulse or
shimmer is a short timeline the scene clock plays after a change; a picture that truly moves all the
time is a live surface (`realtime-game-loop`), paused by the same lifecycle.

## The frame-time hook

A frame-time recorder never owns a frame callback (an extra one would keep idle screens rendering).
Pass `onFrameTime` (a worklet) to `useSurfacePlayer`; `runSceneFrame` calls
`wiring.onFrameTime?.(info.timeSincePreviousFrame)` on every frame the clock runs, so the recorder
measures the surface's own frames. Production builds pass nothing. The recorder, its histogram and the
budgets belong to `performance-budgets`.
