# Gesture Handler 2 now, 3 later

Expo SDK 57 pins `react-native-gesture-handler` ~2.32.0 (the builder API); Gesture Handler 3 (the hook
API) arrives with a later SDK. Read this when the Expo SDK moves Gesture Handler, or when an example
online uses the other API. Verified on 2026-10-03: SDK 57's `bundledNativeModules.json` lists ~2.32.0,
which resolves to 2.32.0; npm's `latest` tag is 3.3.0 and its `legacy` tag 2.33.0. Re-verify with
`node -p "require('expo/bundledNativeModules.json')['react-native-gesture-handler']"` in the app and
`npm view react-native-gesture-handler dist-tags`.

## Today: the 2.32 builder API

- `Gesture.Tap()`, `Gesture.LongPress()`, `Gesture.Pan()`, composed with `Gesture.Exclusive(pan,
  longPress, tap)`, attached with `<GestureDetector gesture={gesture}>` (the canvas kit's
  `SurfaceCanvas` renders the detector).
- Callbacks: `onStart`, `onUpdate`, `onEnd((event, isSuccess) => ...)`, `onFinalize`.
- Types: `TapGesture`, `LongPressGesture`, `PanGesture`, `ExclusiveGesture`.
- Install only with `npx expo install react-native-gesture-handler` (never past Expo's pin by hand) and
  re-check with `npx expo install --check`.

## Later: the 3.x hook API

Read in `react-native-gesture-handler@3.2.1`'s type declarations (`lib/typescript/v3/`) on 2026-10-03:

| 2.32 builder API | 3.x hook API |
|---|---|
| `Gesture.Tap().onEnd((e, success) => ...)` | `useTapGesture({ onDeactivate: (e) => { if (e.canceled) return; ... } })` |
| `onBegin` / `onStart` | `onBegin` / `onActivate` |
| `onEnd` | `onDeactivate` (its event carries `canceled`) |
| `onChange` + `onUpdate` | `onUpdate` |
| `onFinalize` | `onFinalize` (its event carries `canceled`) |
| `.withTestId('canvas.tap')` | `testID: 'canvas.tap'` in the config |
| `Gesture.Exclusive(a, b, c)` | `useExclusiveGestures(a, b, c)`; also `useSimultaneousGestures`, `useCompetingGestures` |
| `TapGesture`, `ExclusiveGesture` ... | the builders remain as deprecated `LegacyTapGesture`, `LegacyExclusiveGesture` ... |

The composition hooks take 3.x gestures only (`AnyGesture`, the 3.x `Gesture` type), so a canvas never
mixes the two APIs. `fireGestureHandler` and `getByGestureTestId` still come from
`react-native-gesture-handler/jest-utils` and accept 3.x gestures.

## The migration plan

1. Move the Expo SDK with expo-sdk-upgrade; `npx expo install react-native-gesture-handler` picks the
   new pin.
2. Rewrite `src/canvas/gestures/use-canvas-gestures.ts` as a whole, in one commit: the same exports
   (`useCanvasGestures`; `makeStickGesture` becomes a hook, `useStickGesture`), the same test ids, the
   same single-intent, hover-on-change and finalize rules. No other canvas file builds gestures; an
   ordinary UI control elsewhere (a slider in `src/ui/`) moves in the same SDK commit.
3. Re-read the 3.x testing guide, run `use-canvas-gestures.test.tsx`, and fix tests only where the
   testing API changed, never to make a behaviour pass.
4. `node ${CLAUDE_SKILL_DIR}/scripts/check-canvas-input.mjs .` checks that the gesture module's API
   matches the installed major version (`rngh-api-version`); it reads
   `node_modules/react-native-gesture-handler/package.json`, else the `package.json` specifier.
