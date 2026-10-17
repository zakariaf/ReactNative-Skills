# The canvas input pipeline

How a finger on a Skia canvas becomes at most one `CanvasIntent`, and how that intent becomes a domain
action. Read this before touching `src/canvas/gestures/` or a surface's intent function, and before
choosing a surface's pan mode.

## Contents

- The pipeline
- The CanvasIntent contract
- Hit-testing with the surface's layout
- Gesture composition and thresholds
- Pan modes and how to choose one
- Pointer, hover and the drag lift
- Coordinates and right-to-left
- Touch targets
- The root view, the detector and React Native touch
- System back gestures (iOS and Android)
- Accessibility and end-to-end taps
- Files, prerequisites and owner skills
- The contract and rn-skills.config.json keys
- When multi-package

## The pipeline

```
Gesture.Tap / LongPress / Pan                 UI thread (worklets), src/canvas/gestures/use-canvas-gestures.ts
  → hitTest(layout.get(), point, HIT_SLOP)     the SAME CanvasLayout the picture draws with
  → classifySwipe | drag from→to | aim          panIntent(): at most ONE intent per gesture
  → scheduleOnRN(onIntent, intent)              JS thread
  → the model hook: a tap in a select region toggles its UI-only selection and stops here;
                    any other tap gets `selected` filled in; a drag-end clears the selection
  → intentToAction(state, intent) → Action | null      pure, in the surface folder
  → dispatch(action)                                   the store applies and saves, then the canvas animates
```

- `use-canvas-gestures.ts` is the **only** file that builds canvas gestures. A Gesture Handler major
  rewrites one file, and a canvas can never act twice for one touch.
- Gestures never decide what a touch means. They report what the finger did in canvas terms; the
  surface's pure intent function returns an action or `null`.
- The model hook (`use-<feature>-model.ts`, or a small input hook it calls) owns the selection, calls
  the intent function and dispatches. `examples/progress-grid/use-progress-grid-input.ts` is the shape.

## The CanvasIntent contract

```ts
// src/canvas/gestures/canvas-intent.ts
export type CanvasIntent =
  | { readonly kind: 'tap'; readonly target: CanvasTarget; readonly selected: CanvasTarget | null }
  | { readonly kind: 'long-press'; readonly target: CanvasTarget }
  | { readonly kind: 'swipe'; readonly direction: SwipeDirection; readonly from: CanvasTarget | null }
  | { readonly kind: 'drag-end'; readonly from: CanvasTarget; readonly to: CanvasTarget | null }
  | { readonly kind: 'aim'; readonly dx: number; readonly dy: number };   // release vector, canvas points
```

`CanvasTarget` (`{ regionId, col, row }`) comes from the canvas kit's `canvas-layout.ts`. Kinds are
kebab-case literals. `selected` is the screen's tap-then-tap selection (the target of an earlier tap
inside a select region, such as an inbox chip), or `null`: UI state the model hook keeps, never domain
state and never an action. The gesture layer always sends `selected: null`.

## Hit-testing with the surface's layout

The canvas kit's `src/canvas/canvas-layout.ts` (a `'worklet'` module owned by skia-canvas-rendering)
holds the layout both sides share: `hitTest(layout, point, slop)`, `cellRect(layout, target)`,
`isSameTarget(a, b)`, `fitGrid(...)`.

- A region the point is truly inside always wins; otherwise the nearest region whose slop reaches the
  point (two regions may sit closer than the slop).
- A mirrored region is mirrored as a rectangle, exactly as `cellRect` draws it, so a cell's left edge
  belongs to that cell in both directions. Never mirror the touch point instead (`width - point.x`): that
  flips the half-open cell intervals and moves every drawn left edge to the neighbouring column.
- The gesture module reads the layout from the derived value `useSurfacePlayer()` returns, the value the
  picture uses, so what you see is what you touch at any canvas size, rotation or window size.
- Regions exist only for tappable areas. A tap outside every region (beyond the slop) sends no intent; it
  calls the optional `onMiss`, and the model hook drops its selection.
- `HIT_SLOP = 8` pt extends every region for edge taps. It does not make a small target big enough
  (touch targets below).

## Gesture composition and thresholds

`Gesture.Exclusive(pan, longPress, tap)`: pan beats long press beats tap. A tap waits only until the
finger lifts, so taps feel instant.

| Constant | Value | Where |
|---|---|---|
| `TAP_MAX_MS` | 250 ms | tap `maxDuration` |
| `LONG_PRESS_MS` | 450 ms | long-press `minDuration` |
| `PAN_MIN_DISTANCE` | 10 pt | pan activation (the pan is disabled for `panMode: 'none'`) |
| `HIT_SLOP` | 8 pt | every `hitTest` |
| `DEFAULT_SWIPE` | 24 pt or 600 pt/s on the dominant axis, dominance 1.2 | `classifySwipe` |

These are starting values: tune per surface after trying them on a phone, the same on iOS and
Android (Gesture Handler reports points on iOS and density-independent pixels on Android, so one
number fits both). Every builder carries a literal `.withTestId('canvas.<kind>')`
(`canvas.tap`, `canvas.long-press`, `canvas.pan`, `canvas.stick`) so Jest can drive it.

Callbacks on the UI thread:

- Tap: `onEnd((event, isSuccess) => ...)`: a successful tap on a region emits `{ kind: 'tap', target,
  selected: null }`; off every region it calls `onMiss`.
- Long press: `onStart` emits `{ kind: 'long-press', target }` once the hold is recognised.
- Pan: `onStart` records `dragFrom` (the hit of the start point `event.x - event.translationX`, never
  lifted), `onUpdate` moves the lifted pointer and reports hover changes, `onEnd` turns the lifted
  release into one intent with `panIntent`, `onFinalize` resets the pointer (it runs on success,
  failure and cancel).

## Pan modes and how to choose one

`panIntent({ mode, pointer, release, layout, dragLiftPt })` turns a finished pan into at most one intent:

| Mode | Intent | Notes |
|---|---|---|
| `none` | nothing (pan disabled) | taps and long presses only |
| `swipe` | `{ kind: 'swipe', direction, from }` | `null` when too short and too slow, or when no axis dominates by 1.2 |
| `drag` | `{ kind: 'drag-end', from, to }` | only when the drag started on a region; `to` is the hit of the lifted release point, `null` off every region |
| `aim` | `{ kind: 'aim', dx, dy }` | the release vector in canvas points; the intent function normalises and quantises it |

| The interaction | Pan mode | Example |
|---|---|---|
| Tap a cell to act (toggle a day, open a slot, flip a light) | `none` | `examples/progress-grid/` (Lights Out maps the same way) |
| Tap, and hold for a second action | `none` (long press is always on) | a flag on a cell; needs a non-hold alternative |
| Move an item from one place to another | `drag` (plus tap-then-tap) | `examples/inbox-planner/` |
| One move per direction (slide, tilt, shift a week) | `swipe` | `examples/sliding-puzzle/` |
| Pull back and let go | `aim` | `examples/arena-aim/` |
| Steer continuously (a simulation) | the stick gesture, not a pan mode | `stick-input.md` |

## Pointer, hover and the drag lift

- The finger state is a `PointerSample` (`isDown`, `x`, `y`, `hover`, `dragFrom`; the canvas kit's
  `canvas-types.ts`) in a shared value the gesture worklets write and `draw()` reads as
  `frame.fx.pointer`: drag previews and hover rings never go through React.
- Only hover **changes** go to JS (`onHover(target)`, compared with `isSameTarget`), where the domain
  can compute a preview of the action (which days a task fits on).
- **The drag lift is applied once, here.** When a thumb would hide the dragged item, the surface
  declares `dragLiftPt` (`CanvasSurface.dragLiftPt`) and the model hook passes `surface.dragLiftPt ?? 0`
  to `useCanvasGestures`. The gesture layer shifts the pointer it uses for the hover, the drawn preview
  and the drop target by the same `liftedPoint(point, dragLiftPt)`; the press that starts the drag is
  never lifted. The intent function and `draw()` add nothing, so the preview cell is the drop cell (the
  kit's gesture test proves it; skia-canvas-rendering's draw test proves the preview sits on the hover).
- **A lift must not strand an edge row.** A surface with a lift keeps at least `dragLiftPt` of canvas
  below its last row (a tray below it in portrait, a free strip when the tray stands beside it), and its
  hit-targets test proves every edge row reachable on portrait and wide canvases with
  `unreachableByDrag(layout, edgeRowTargets(layout, regionId), dragLiftPt)`.
- **Selection and hints are not pointer state.** The model hook passes them as the `highlight` prop
  (`CanvasHighlight { selected, hinted }`), and `draw()` reads `frame.highlight`.

## Coordinates and right-to-left

- `event.x/y` are canvas-local and physical: they do not mirror under right-to-left layout. Verified on
  the iOS simulator with `forceRTL(true)`; on Android, Gesture Handler reports the view's own
  left-origin coordinates too (its documented behaviour; not verified on an emulator here). Swipe
  directions are physical as well.
- A surface that mirrors (`isMirroredInRtl: true`, a time axis) mirrors positions only in its layout, and
  `hitTest` mirrors with it. Gesture code never reads `I18nManager`, `isRtl` or `isMirrored`
  (`physical-coords`).
- Which surfaces mirror, and how the direction switch and reload work, is rtl-and-direction's job.

## Touch targets

- Every tappable region's cell is at least `MIN_TOUCH_PT` on the smallest canvas the app supports.
  `MIN_TOUCH_PT` (`src/canvas/gestures/touch-targets.ts`) follows `quality-gates.json`
  `a11y.minTouchPt`, which accessibility-as-code owns: 44 pt (Apple's minimum) by default, 48 for an app
  sized to Material's 48 dp. The checker fails a constant below the gate (`touch-target-min`).
- "The smallest canvas" is the app's smallest supported window minus its chrome: for example 360 × 640 dp
  (a small Android phone; every current iPhone is larger, the iPhone SE at 375 × 667 pt) minus 16 pt side
  gutters and about 200 pt of status bar, header and tab bar, so 328 × 440. Use your own numbers, and lay
  out the largest view the surface ever shows (a month, the biggest board).
- A region below the minimum changes the layout (fewer columns, a tray beside the grid, scrolling the
  canvas), never the test. `hitSlop` on the canvas is no fix: it is invisible in layout, overlaps
  neighbours and does not move the screen reader's focus frame. An exception is a design decision the
  reviewer signs off and records in the test, not a smaller number.

## The root view, the detector and React Native touch

Gesture Handler needs `GestureHandlerRootView` around everything that uses gestures, as the app's
outermost native view; without it no canvas gesture fires on a device (Jest's mock does not notice). In
an Expo Router app it goes in the root layout (`src/app/_layout.tsx`) or in the component the root
layout renders; context providers render no native view, so inside them is still outermost.

```tsx
<GestureHandlerRootView style={styles.root}>   {/* StyleSheet.create({ root: { flex: 1 } }) */}
  <Stack screenOptions={{ headerShown: false }} />
</GestureHandlerRootView>
```

The canonical lint bans inline styles and nests JSX at most 5 deep: when the root layout's providers
already fill that depth, put the root view in the component it renders (the root stack component).
With the React Navigation static API, wrap the `<Navigation />` element in the same way in `App.tsx`.
An Android `<Modal>` renders outside the root view and needs its own `GestureHandlerRootView` inside
when it holds a canvas.

**The detector holds only the canvas.** `<SurfaceCanvas input={...}>` wraps the canvas in the gesture
module's `GestureDetector` and nothing else sits inside it: a `Pressable*`, `Touchable*`, `Button`,
`*Button` or a contract `buttonComponents` entry inside a canvas detector competes with Gesture Handler
for the same touch (`pressable-in-detector`). Render buttons as siblings of the canvas.

**No React Native touch on a canvas** (`canvas-rn-touch`). React Native's touch system hit-tests a view
on its own: it knows nothing of the surface's `CanvasLayout`, `HIT_SLOP`, mirroring or the one-intent
rule, so a tap handled there drifts from the drawing and can fire beside a gesture-module intent. The
checker flags, in every file of the canvas scope:

- a `Pressable*`, `Touchable*`, `Button`, `*Button` or `buttonComponents` element anywhere around a
  `<Canvas>` or `<SurfaceCanvas>`;
- `onPress`, `onPressIn`, `onPressOut`, `onLongPress`, `onTouchStart/Move/End/Cancel` (and their
  `Capture` forms), `onResponder*` or `onStartShouldSetResponder`/`onMoveShouldSetResponder` on the
  canvas element itself or on the element that directly wraps it.

Take the touch through the gesture module instead (a new pan mode or intent kind in
`use-canvas-gestures.ts`). The one legitimate exception is a **whole-card press around a display-only
canvas** (a stats card that opens a screen, with a decorative sparkline drawn inside): the press does
not care where on the canvas the finger lands, so it is an ordinary control. List that file in
`contracts/canvas-input.json` `gestureExempt`; a contract that holds only `gestureExempt` (no
`surfaces`) does not make the check demand the input kit, so an app with no interactive canvas stays
NOT APPLICABLE. Until then, React Native touch on a canvas in an app without the input kit reports
only `canvas-rn-touch` (no missing kit files, no root view): choose the gesture module or the exemption.

## System back gestures (iOS and Android)

- **iOS full-screen back.** The native stack's `fullScreenGestureEnabled` is `true` by default on iOS 26
  and later (false on iOS 18 and earlier), so a rightward swipe anywhere on a pushed screen can go back
  (read in expo-router 57.0.24 `build/react-navigation/native-stack/types.d.ts` on 2026-10-03; re-verify:
  `grep -n -A12 "fullScreenGestureEnabled" node_modules/expo-router/build/react-navigation/native-stack/types.d.ts`).
  A canvas that reads horizontal swipes, drags or aims sets it to `false` on its screen:
  `<Stack.Screen name="planner" options={{ fullScreenGestureEnabled: false }} />` in the route's
  `_layout.tsx` (React Navigation static: the screen's `options`). `gestureEnabled: false` also turns
  off the edge swipe; keep it only when the screen has its own back control.
- **iOS edge swipe and Android gesture navigation.** Both claim swipes that start at the screen's side
  edges (Android's system gesture insets are set by the user's back-sensitivity setting; Android 15 and
  later draw apps edge to edge, so the canvas can reach the edge unless the layout keeps a gutter).
  Keep the canvas inside the screen's side gutters, never start a swipe-to-act at the edge, and test with
  gesture navigation on in the emulator. Predictive back on Android shows the previous screen while the
  edge swipe runs; a canvas pan that starts inside the gutter never triggers it.
- What was verified here: the option names and defaults from the installed declarations. The outcome of
  a conflict on a device was not measured: check it by hand (testing-gestures.md, "On devices").

## Accessibility and end-to-end taps

- The canvas is one accessible image with a spoken summary (skia-canvas-rendering, accessibility-as-code).
  VoiceOver and TalkBack users cannot aim at cells, so the main actions get another way in: a list
  view of the same items, `accessibilityActions` on the canvas, or controls beside it.
- A hold-only action (long press to flag, to delete) also needs a non-hold way: a mode toggle on the
  screen that turns taps into that action, or an accessibility action. TalkBack sends a long press on
  double-tap-and-hold; VoiceOver has no reliable equivalent on a canvas.
- Announce a selection made by a tap with accessibility-as-code's `useAnnounce()` (one short sentence).
- End-to-end flows cannot find cells by testID (a Skia canvas has no accessibility children). In test
  builds the canvas kit's `canvas-layout-probe.tsx` publishes the canvas origin and layout, and Maestro
  taps `origin + region origin + (col + 0.5) × cell` (mirrored surfaces from the right); e2e-maestro owns
  the flow. `adb -s <serial> shell input tap` takes physical pixels: multiply points by the density
  (`adb -s <serial> shell wm density` / 160).

## Files, prerequisites and owner skills

This skill owns `src/canvas/gestures/` (copied from `templates/src/canvas/gestures/`), the shape of each
surface's intent function and hit-targets test, and `contracts/canvas-input.json`.

| Needs | Path | Owner skill |
|---|---|---|
| `CanvasLayout`, `CanvasTarget`, `Point`, `hitTest`, `cellRect`, `isSameTarget`, `fitGrid` | `src/canvas/canvas-layout.ts` | skia-canvas-rendering (canonical; synced into this skill's templates) |
| `PointerSample`, `IDLE_POINTER`, `CanvasHighlight`, `CanvasSurface.dragLiftPt` | `src/canvas/canvas-types.ts` | skia-canvas-rendering (canonical) |
| `SurfaceCanvas` (`input={{ gesture, pointer }}`), `useSurfacePlayer().layout` | `src/canvas/` | skia-canvas-rendering |
| Gesture Handler, Reanimated, Worklets at the SDK pins | dependencies | expo-project-bootstrap (`npx expo install`) |
| `jest.setup.ts` with the Gesture Handler, Worklets and Reanimated lines | root | unit-and-component-tests |
| `quality-gates.json` `a11y.minTouchPt` | root | quality-gates (value from accessibility-as-code) |
| The root layout | `src/app/_layout.tsx` | app-startup-and-bootstrap |
| Games may import the canvas kit (`src/canvas/**` is in the default `gameFacing`; no entry needed) | `contracts/architecture.json` only if the kit moved | architecture-and-boundaries |

`classify-swipe.ts`, `stick-command.ts` and `pan-intent.ts` run inside gesture callbacks on the UI
thread, so each starts with `'worklet';` (after the path comment) and imports values only from other
`'worklet'` modules (`input-worklet`). `touch-targets.ts` is used by tests and runs on the JS thread.

## The contract and rn-skills.config.json keys

`contracts/canvas-input.json` (optional; template and schema in `templates/contracts/`):

```json
{
  "$schema": "./canvas-input.schema.json",
  "surfaces": [
    { "id": "progress-grid", "dir": "src/features/tasks/canvas" },
    { "id": "chase", "dir": "src/games/chase/canvas", "input": "stick" },
    { "id": "planner", "dir": "src/features/planner/canvas", "intentFile": "src/features/planner/canvas/intent-to-action.ts" }
  ],
  "buttonComponents": ["PressableSurface", "IconButton"],
  "gestureExempt": ["src/features/tasks/components/task-row.tsx"]
}
```

- A surface takes touch when the contract lists it, when its folder holds the intent file
  (`intent-to-action.ts`; a game surface `src/games/<id>/canvas/intent-to-move.ts`), or when a file of
  its feature folder (the surface folder's parent) calls `useCanvasGestures` or `makeStickGesture`.
  A stick surface (`"input": "stick"`, a `sim/` folder beside the canvas folder, or only
  `makeStickGesture`) needs no intent function and no hit-targets test. `tappable` overrides the
  default (a layout file that calls `fitGrid` or lists regions).
- `buttonComponents` adds the app's own touchables to the `pressable-in-detector` and `canvas-rn-touch`
  lists (`Pressable*`, `Touchable*`, `Button` and every `*Button` are always on them). `gestureExempt`
  lists files inside the canvas scope that own an ordinary gesture or press (a swipeable row in the same
  feature, a whole-card press around a decorative canvas). Only `surfaces` is evidence that a canvas
  takes touch: a contract with just `gestureExempt` or `buttonComponents` asks for no input kit.
- **The canvas scope** (where `gesture-one-file`, `pressable-in-detector` and `canvas-rn-touch` look):
  - the canvas kit, every surface folder, and every file that renders `<Canvas>`, `<SurfaceCanvas>` or
    `<SurfaceHost>`;
  - every app file whose import feeds a canvas, wherever it lives (`src/hooks`, `src/ui`): what a canvas
    `GestureDetector`'s `gesture={...}` or a `<SurfaceCanvas input={...}>` reads, directly or through a
    local `const` (`const scrub = useScrubGesture();`), and every component rendered around a canvas
    (`<DaySwipe><SurfaceCanvas .../></DaySwipe>`). The problem names the canvas file that hands it on;
  - the feature folder of a surface that takes touch or of a file that hands touch to a canvas
    (`<SurfaceCanvas input={...}>`, a `GestureDetector` around a canvas), minus its **self-contained
    controls**: a `.tsx` file that renders its own `GestureDetector` around no canvas and no component that
    renders one, imports no value from the canvas kit or a surface folder, and calls neither
    `useCanvasGestures` nor `makeStickGesture`. motion-and-animation's bottom sheet
    (`src/features/tasks/components/task-sheet.tsx`, a `Gesture.Pan()` around an `Animated.View`) beside
    the interactive progress grid is one and needs no exemption. A `.ts` hook in that folder that builds a
    gesture for someone else is never one: list it in `gestureExempt` when it is ordinary UI.

  The feature folder of a display-only surface is not in scope, so a sheet handle's `Gesture.Fling()`
  beside a weekly chart that takes no touch needs no exemption. A host that renders its own canvas inside
  a `GestureDetector` with a gesture it receives as a prop (realtime-game-loop's board host, handed the
  kit's `makeStickGesture`) builds no gesture and passes; only a builder outside `use-canvas-gestures.ts`
  is a problem.
- **Limits of the scope heuristic.** The checker reads source text, not the render tree, and follows
  imports one step. It does not see:
  - a gesture that reaches the canvas through a second hop: a hook in `src/hooks` returned by the
    feature's model hook, which the screen then passes as `input={model.input}` (the model hook is seen,
    the hook it imports is not);
  - a gesture passed as a prop or through context and attached to a canvas in another file;
  - a self-contained control rendered around a component that renders the canvas, in a file that does
    not render the canvas itself (the screen renders `<DaySwipe><GridCard /></DaySwipe>` and `GridCard`
    renders `<SurfaceCanvas>`);
  - a touchable that wraps a canvas across a component boundary (`canvas-rn-touch` reads one file).

  The rule still holds there: the review and the gesture tests catch what the text scan cannot.
- A malformed contract, or a surface whose folder does not exist, is bad input (exit 2).

`rn-skills.config.json` keys this skill reads, besides check-lib's layout keys (`srcDir`, `featuresDir`,
`routesDir`, `contractsDir`): `"canvasKitDir"` (skia-canvas-rendering's key, default `src/canvas`),
`"canvasGesturesDir"` (default `<canvasKitDir>/gestures`) and `"canvasSurfaceDirs"` (skia-canvas-rendering's
globs, default `src/features/*/canvas` and `src/games/*/canvas`; a configured glob that matches no folder
is exit 2). The options `--kit-dir`, `--gestures-dir` and `--surface-dir` override them.

## When multi-package

With npm workspaces (`apps/*`, `packages/*`) the checker reads `package.json` `workspaces`, looks for
the canvas kit in each workspace's `<srcDir>/canvas` and for surfaces in each workspace's
`<featuresDir>/*/canvas`, and resolves `@/` imports through each workspace's `tsconfig.json`. A kit
shared by several apps lives in one package: pass `--kit-dir packages/canvas/src` and
`--gestures-dir packages/canvas/src/gestures` (or set the config keys). Workspace packages consumed as
TypeScript source need explicit `.ts` extensions in imports (the canonical lint's multi-package mode);
the templates use the single-app, extensionless style.
