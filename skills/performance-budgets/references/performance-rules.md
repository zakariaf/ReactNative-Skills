# Performance rules in practice

What keeps an app inside the budgets, why each rule exists, what to do instead, and which skill's
checker proves it.

## Contents

- Who checks what
- Per-frame work
- Skia cost
- Frame callbacks and textures
- Lists and grids
- Bundle, Hermes and start-up
- Re-renders

## Who checks what

A rule is checked once, by the skill that owns it; this skill measures the result.

| Rule | Checked by |
|---|---|
| React setter inside `useFrameCallback` | this skill: `check-perf-code` `react-state-per-frame` |
| `scheduleOnRN` / `runOnJS` inside a per-frame worklet (outside the canvas folders) | motion-and-animation: `no-js-per-frame` |
| Skia allocation in a worklet function outside the canvas folders | this skill: `skia-alloc-per-frame` |
| Skia allocation in a frame-hook callback, or in a canvas draw file | skia-canvas-rendering: `frame-alloc`, `draw-pure` |
| A frame callback that can never stop | this skill: `frame-callback-stop`; canvas surfaces also skia-canvas-rendering's `frame-callback-body`, `idle-clock`, `lifecycle` |
| Endless loops (`withRepeat(…, -1)`) on ordinary views | motion-and-animation: `loop-through-hook` |
| A draw test exists and asserts a budget ≤ 1,000 | skia-canvas-rendering: `draw-budget` |
| A draw budget above the app's own ceiling | this skill: `draw-call-budget` |
| Canvases per screen, canvas per list item | this skill: `canvases-per-screen`, `canvas-per-item` |
| A `ScrollView` mapping data that can grow, index keys | react-components-and-hooks: `scrollview-list`, `list-key-index` |
| `CADisableMinimumFrameDurationOnPhone` kept on iOS | skia-canvas-rendering: `plist-120hz` |
| Locale data only in the polyfill module | this skill: `intl-locale-data`; the module's exact list: i18n-strings-and-catalogs `polyfill-locales` |
| Startup order, deferred work, `InteractionManager` | app-startup-and-bootstrap |
| Nothing at import time | architecture-and-boundaries: `import-time-work` |
| Test-only code absent from production bundles | app-variants-and-environment: `check-variant-bundle` |

## Per-frame work

- **Never put per-frame data in React state.** Positions, timelines and particles live in shared values
  and Skia pictures. React renders on events (a tap, a committed change, a setting), never per frame:
  at 120 Hz a frame is 8.3 ms, and one React render of a screen does not fit.
- Numbers on screen that change on events (a count, a total) come from a store through a primitive
  selector, never from a shared value read on the JS thread every frame.
- A per-frame value that the JS side truly needs crosses once: when the animation ends, or in a
  `useAnimatedReaction` when it passes a threshold (motion-and-animation's rule).
- Read and write shared values with `.get()` and `.set()`.

## Skia cost

Recording a picture costs roughly one command per draw call, and replaying it costs the GPU work. Reduce
both:

| Do | Instead of |
|---|---|
| Create paints, colours, paths, fonts, paragraphs and recorders once (module scope, a `useState` initializer, the canvas kit's draw kit) and pass them in | `Skia.Paint()` / `Skia.Color('#…')` inside a worklet that runs per frame |
| Draw static backgrounds (a grid, axes, a frame) as retained nodes or one cached picture | Re-recording the static layer every frame |
| Use an atlas (`<Atlas>`) for 100 or more identical sprites: one draw call | One `drawImage` / `drawCircle` each |
| Stop the frame callback when the animation ends | Leaving it running on an idle screen |

- **At most `skiaCanvasesPerScreenMax` (8) canvases per screen file**, and never one per list item:
  each costs memory and a first-frame delay (about 0.18 MB and 2.8 ms for a 48 × 15 pt canvas at 3×,
  measured on the iOS simulator). Single-colour icons are rasterized once and shown as tinted images
  (the Icon primitive): 90 tiles with rasterized icons mounted 4.8 × faster and used 15 MB less than one
  canvas per tile. A screen that measured fine with more goes into `contracts/perf.json`
  `canvasBudgetExempt` with the numbers as its reason.
- Text on a canvas: numbers formatted in JS and drawn as strings; words and complex scripts through a
  cached `Paragraph`, built once per text change, never per frame (skia-canvas-rendering).

## Frame callbacks and textures

- **Stop every frame callback** when its animation ends, when the app goes to the background, while a
  full-screen interruption (a modal, an ad, a video) covers it, and when its screen loses focus:
  `useFrameCallback(callback, false)` starts it inactive, and `setActive(true / false)` follows the
  lifecycle. The recorder must show no frames while the screen is idle. (Reanimated 4.5.1 stops its
  Android Choreographer callback when the activity pauses, and iOS delivers no display-link frames to a
  backgrounded app; an unfocused screen that a stack keeps mounted keeps rendering unless you stop it.)
- **What `frame-callback-stop` sees, and what it cannot.** Per file: every `useFrameCallback` call needs
  a second argument that is not missing and not `true` (`false`, or an identifier the hook's caller
  controls); and the file must stop it, either `handle.setActive(...)` or a `setActive` destructured
  from the result (`const { setActive } = useFrameCallback(cb, false)`, also renamed as
  `{ setActive: setTicking }`) and called bare. It cannot see whether the stop runs on every path that
  needs it (animation end, background, blur, a full-screen interruption), whether an identifier passed
  as the second argument is ever `true` at mount, or a stop in another file that receives the handle
  (a clock driver): such a file still needs a `.setActive(` call of its own to pass, so keep the stop
  next to the hook or pass the handle to a function in the same file. Review those halves by hand, and
  confirm with the recorder that an idle screen records no frames.
- **What `react-state-per-frame` sees.** A React setter (`setX(...)`) inside the inline callback of
  `useFrameCallback(...)`, or inside a same-file function named as its first argument
  (`const onFrame = (info) => { ... }; useFrameCallback(onFrame, false)`). It does not follow a helper
  that the callback calls, a callback imported from another file, or a setter passed in under a name
  that does not start with `set`; review those by hand.
- **The recorder samples, it never drives.** A canvas surface passes `onFrameTime` (a worklet) to
  `useSurfacePlayer`; a live loop calls `sampleFrame(recorder, info.timeSincePreviousFrame)` from its
  runner. In store builds `isRecording` stays false, so `sampleFrame` returns after one read.
- **Dispose pre-rendered textures** (`SkImage`, `SkPicture`) with `.dispose()` when the palette or theme
  changes; a texture costs `w × h × 4` bytes (1024² is 4 MB).

## Lists and grids

- **`FlatList` by default** for anything that grows with the user's data, keyed by a stable id.
- **FlashList** (`@shopify/flash-list` 2.0.2, in the SDK 57 module map) only after a Release-build
  measurement shows the `FlatList` is the bottleneck; recycled cells keep their state between items.
- **A `ScrollView` that maps data** only for a short list that can never grow; react-components-and-hooks
  asks for a `// bounded-list:` comment that states the bound.
- **Measure before switching** (the measuring reference has the method). One measurement from the source
  app (iOS 26.5 simulator, Release, 90 tiles of 72 pt, medians of 6 cold launches, 2026-09-26; Android
  not measured): `ScrollView` with plain views laid out the last tile at 26 ms (49–50 MB); `FlatList`
  40 ms (50 MB); FlashList 40 ms and only 85 tiles after 1.5 s (51 MB); one Skia canvas per tile
  264–280 ms (66 MB). At 90 fixed items virtualization saved nothing; at a few hundred items that grow,
  the `ScrollView` mounts every row and the `FlatList` wins.

## Bundle, Hermes and start-up

- **Check the bundle delta before adding a runtime dependency** (export before and after, each platform).
  Every module in the bundle is start-up work: Hermes memory-maps the bytecode, so size matters mostly
  through the module initialisation it implies.
- **Locale data only for the app's languages, only in the polyfill module.** The forced FormatJS
  polyfills for four languages added 0.85 MB of JS (0.59 MB of bytecode) and loaded in 11 ms on the
  simulator; they are needed because Hermes lacks `Intl.PluralRules`, `Intl.Locale` and numbering
  systems.
- **Keep Hermes V1**, the default engine since React Native 0.84: no `jsEngine` key, no
  `RCT_HERMES_V1_ENABLED`, no `useHermesV1: false` in expo-build-properties, no JavaScriptCore package.
  Verified on 2026-10-10 in the installed SDK 57 sources: `@expo/config-plugins` 57 still writes
  `expo.jsEngine` from `jsEngine` / `ios.jsEngine` / `android.jsEngine` (default `hermes`), and
  expo-build-properties documents `useHermesV1` (default true; false needs
  `buildReactNativeFromSource`). Re-verify: `grep -rn jsEngine node_modules/@expo/config-plugins/build/ios/BuildProperties.js`.
- **Generate no code at runtime:** no `eval`, `new Function` or string `setTimeout`. A validator library
  that compiles with `new Function` needs its non-JIT mode (valibot never compiles).
- **Keep module scope and start-up cheap.** Before the first screen: the data layer, settings, the
  language and the stores (app-startup-and-bootstrap's order). Everything else (ads, consent,
  purchases, analytics, remote config, prefetches, texture warm-ups) starts after the first screen.
  No module does I/O at import time.

## Re-renders

- Pin the re-render boundary of hot components (the first screen, a list row, a live counter) with a
  `<Profiler>` test that fails when the component subscribes to an unrelated store; over-subscription
  is invisible without one (react-components-and-hooks owns the test pattern; Jest runs uncompiled, so
  it proves subscriptions, not memoization).
- Pass a selector to every store hook; a selector that builds an object uses `useShallow`
  (state-management-zustand).
