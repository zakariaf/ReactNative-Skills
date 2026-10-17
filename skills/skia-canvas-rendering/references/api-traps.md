# Worklet rules and API traps (Expo SDK 57 stack, verified on 2026-10-03)

What training data gets wrong about Skia 2.6.2, Reanimated 4.5.1, Worklets 0.10.1 and Gesture
Handler 2.32.0, and the rules for code that runs on the UI thread. Read this before writing any
worklet, frame callback or Skia call, and when something works in Jest but crashes on a device.

## Contents

- Worklet rules
- API churn table
- Re-verify when versions move

## Worklet rules

- **File-level directive.** `'worklet';` as the first statement (after the `// path` comment)
  workletises every top-level function of the file. Verified with SDK 57's `babel-preset-expo`
  57.0.13 and Worklets 0.10.1: a directive file produced one worklet per top-level function, a file
  without it none, and draw, layout and timeline modules ran on the UI thread in a Release build with
  React Compiler on. The kit's UI-thread modules carry it (`canvas-layout`, `timeline/*`, `scene`,
  `scene-clock-state`, `run-scene-frame`, `record-picture`, `describe-error`, `draw-text`), and so do
  each surface's `draw*`, `layout*` and the helpers they call (`canvas-ids.ts`).
  `worklet-transform.test.ts` proves the plugin ran.
- **Imports.** A worklet can call another worklet imported from a `'worklet'` module (it is captured
  in its closure). It cannot call a plain JS function: that throws on the UI thread at runtime. Type-only
  imports are erased and always fine. `react-native-worklets` itself (`scheduleOnRN`) is allowed.
- **Closures are copies.** Values captured by a worklet are copied when it is first scheduled; later
  reassignments on JS are invisible. Anything that changes goes through a shared value.
- **Skia host objects are shared, not copied.** Paints, fonts, paths, paragraphs, pictures and the
  recorder captured in the kit are fine.
- **No third-party code on the UI thread** (Worklets Bundle Mode is not enabled), no promises, no
  `await`, no `setTimeout` in worklets.
- **Not hoisted.** Helper worklets must exist before they run; module-level functions satisfy that.
- **Frame callbacks.** `useFrameCallback((info) => { runSceneFrame(wiring, info.timestamp); }, false)`:
  start inactive, keep the body **one** call into a runner that holds the `try/catch`.
- **UI → JS** only with `scheduleOnRN(fn, ...args)`; a callback that runs on the UI thread must itself
  be a worklet (see `reportDrawError` in `surface-canvas.tsx`, with an inline `'worklet'` directive).
- **Shared values** only with `.get()` / `.set()` (React Compiler needs the accessors); for typed
  arrays mutated in place on the UI thread, call `sv.modify()` afterwards so listeners re-run.
- **Refs passed into helpers** end in `Ref` (`flagsRef`): React Compiler's lint treats any other hook
  argument as immutable and fails an assignment to `.current`.

## API churn table

| Area | Wrong (old) | Right (SDK 57 stack) |
|---|---|---|
| Skia paths | `const p = Skia.Path.Make(); p.addCircle(…)` (deprecated: Skia 2.6.2 warns once per method, natively and in CanvasKit) | `Skia.PathBuilder.Make().moveTo().lineTo().close().build()` (the builder has `addCircle`, `addRect`, `addRRect`, `addOval`, `addArc`, `addPoly`, `addPath` too), `Skia.Path.Circle(x, y, r)`; transform a copy with `Skia.PathBuilder.MakeFromPath(path).transform(m).build()` or draw with `canvas.scale/translate` |
| Skia text width | `font.measureText(t).width` | glyph widths (`textWidth` in `draw-text.ts`); `measureText` is unimplemented in CanvasKit: under Jest it returns a `jest.fn()` stub (so `.width` is `undefined`), in plain Node and on web it throws "Not implemented on React Native Web" (`JsiSkFont.ts`, read on 2026-10-03). `font.getTextWidth(t)` does the same sum natively and in CanvasKit, but Skia 2.6.2 types it `@deprecated` ("Use measureText or getGlyphWidths instead"), so the canonical lint's `@typescript-eslint/no-deprecated` fails it; keep `textWidth` |
| Skia fonts in tests | system fonts, `matchFont`, `provider.matchFamilyStyle(...)` | CanvasKit has none (zero families; `drawText` without a typeface draws nothing, verified on 2026-10-03): load the TTF with `Skia.Typeface.MakeFreeTypeFaceFromData` and pass the typeface itself; CanvasKit's `TypefaceFontProvider.matchFamilyStyle` is a stub (`jest.fn()` under Jest), so only `registerFont` (for paragraphs) works there |
| Skia fonts on device | embed with the `expo-font` plugin, then `Skia.FontMgr.System()` / `matchFont` | works on iOS only: Skia 2.6.2's Android font manager (`SkFontMgr_New_Android(nullptr, …)`) reads only the system font config, so APK fonts silently fall back (source reading). Load the TTF with `useFonts` and pass its provider to the kit and to every `ParagraphBuilder.Make` (`drawing.md`) |
| Skia `opaque` canvas | `opaque` as a free speed-up, or a transparent background on an opaque canvas | Android: `opaque` selects a SurfaceView (no parent clip or alpha, untouched pixels not blended); iOS 2.6.2 ignores the prop (source reading). An opaque canvas paints every pixel first (`drawColor`); a translucent one passes `isOpaque={false}` (a TextureView on Android) |
| Skia `androidWarmup` | on every canvas for a faster first frame | only static, fully opaque canvases (Skia's documentation: animated or translucent canvases can misrender) |
| Skia canvas size | `<Canvas onLayout>` | `<Canvas onSize={sharedValue}>` (or `useCanvasSize()`, measured once). `onLayout` is not supported on the New Architecture: Skia 2.6.2's `Canvas.tsx` types it `@deprecated` and logs a `console.error` when it is passed under Fabric. `onSize` itself measures the view from a Reanimated frame callback on every frame while the canvas is mounted (same file): cheap, records nothing, but not free |
| Skia animation clock | `useClock()` for a pulse or shimmer | it runs a frame callback on every frame while mounted (idle, unfocused, covered) and reads `timeSinceFirstFrame`: play a timeline through the scene clock; no `withRepeat(…, -1)` driving a canvas either (`idle-clock`) |
| Canvas accessibility | `accessibilityRole="image"` + `accessibilityLabel` on the `<Canvas>` | add `accessible`: React Native 0.86 defaults it to false and Skia's `Canvas` passes props straight to its native view, so iOS VoiceOver skips the canvas (`canvas-a11y`; source reading) |
| iOS 120 Hz | add `CADisableMinimumFrameDurationOnPhone` to the Expo config | Expo's prebuild template already sets it `true` (SDK 57, verified on 2026-10-03); never override it with `false`; committed `ios/` folders keep it in `ios/<App>/Info.plist` |
| Skia colours | Reanimated `interpolateColor` | Skia `interpolateColors` (a different colour format) |
| Skia text direction | `textDirection: isRtl && TextDirection.RTL` | `TextDirection.RTL === 0` is falsy; choose explicitly |
| Skia object creation | `Skia.Paint()` inside the per-frame worklet or at module import | once, on JS, in the kit (the recorder: `useState(() => Skia.PictureRecorder())` per canvas) |
| Worklets → JS | `runOnJS(fn)(args)` | `scheduleOnRN(fn, ...args)`; `scheduleOnUI` replaces `runOnUI` |
| Shared values | `sv.value = x` | `sv.set(x)`, `sv.get()` |
| Frame time | `timeSinceFirstFrame` for animation time | `info.timestamp` + the `startAt` sentinel |
| Reduced motion | Reanimated `useReducedMotion()` for live changes | it is read once at app start; pass the live setting (`accessibility-as-code`'s `useReduceMotion`) to `buildTimeline(events, motion)` |
| Mirroring | `transform: [{ scaleX: -1 }]` on the canvas | `isMirroredInRtl` + mirrored positions in the layout |
| Focus | `navigation.addListener('focus')` in the canvas | `useIsFocused()` from expo-router, passed to `useCanvasLifecycle` |
| Worklets Bundle Mode | import any library inside worklets | not enabled; keep UI-thread code self-contained |
| Skia install scripts | nothing to approve | Skia 2.6.2's postinstall copies native libraries: `npm approve-scripts @shopify/react-native-skia` before a local prebuild |

## Re-verify when versions move

Expo SDK 58 brings newer Skia, Reanimated, Worklets and Gesture Handler 3 (a new hook API). When the
app moves (hand the upgrade itself to `expo-sdk-upgrade`):

1. `npx expo install --check`; `node -p "require('expo/bundledNativeModules.json')['@shopify/react-native-skia']"`
   (and `react-native-reanimated`, `react-native-worklets`, `react-native-gesture-handler`).
2. Re-read Reanimated's `src/frameCallback/FrameCallbackRegistryUI.ts` of the new version: does
   `timeSinceFirstFrame` still reset on re-activation? The sentinel fix works either way.
3. Re-check that a JS read of a shared value can still return a stale copy right after a JS write; the
   run token is correct either way, and `scene-clock-traces.test.ts` keeps the reference.
4. Check `measureText`, `TypefaceFontProvider.matchFamilyStyle` and the font manager in the new
   CanvasKit build (`src/skia/web/JsiSkFont.ts`, `JsiSkTypefaceFontProvider.ts`), `onLayout` and
   `onSize` in `src/renderer/Canvas.tsx`, `useClock` in `src/external/reanimated/interpolators.ts`, and on
   device: `createFontMgr()` in `android/cpp/rnskia-android/RNSkAndroidPlatformContext.h` (does Android
   still read only the system font config?) and `setOpaque` in
   `android/src/main/java/com/shopify/reactnative/skia/SkiaBaseView.java` plus `_layer.opaque` in
   `apple/MetalWindowContext.mm` (what `opaque` selects on each platform).
5. Confirm the new prebuild template still sets `CADisableMinimumFrameDurationOnPhone` (the re-verify
   command in `timeline-and-clock.md`, 120 Hz); `plist-120hz` assumes it.
6. Run `npm test`: goldens shift with a new Skia. Review every diff and re-accept one surface at a time
   with `npx jest test/goldens/canvas/<id>.golden.test.ts --selectProjects golden -u`.
7. Gesture Handler 3: the gesture layer migrates in `canvas-gestures-and-hit-testing`; `SurfaceCanvas`
   only passes the gesture object to `GestureDetector`. `surface-canvas.test.tsx` builds its stand-in
   input with the Gesture Handler 2 builder (`Gesture.Tap()`), which GH 3 deprecates and cannot compose
   with hook gestures: switch it to the gesture the migrated layer returns (expo-sdk-upgrade's
   readiness scan lists it).
