# Reanimated, Worklets, Skia and gestures

Failures in frame callbacks, worklets, springs, Skia canvases, frame rates and gestures. Match the text you see in the Symptom column, or run `find-fix.mjs --text "<first error line>"`.

Status: **verified** = seen and fixed in a real run; **documented** = read in the tool's own source or docs; **open** = not settled, the fix is the current fallback. **needs a human** = a stop: send one message and wait, never work around it. Platform: blank = both. Skill = where the full procedure lives. Reviewed on 2026-10-17 against Expo SDK 57 (expo 57.0.27), React Native 0.86.3, React 19.2.3, Xcode 26.6, Android compileSdk and targetSdk 36, Jest 29.7, Maestro 2.10; re-verify the versions with `npm ls react-native-reanimated react-native-worklets @shopify/react-native-skia react-native-gesture-handler`.

<!-- Generated from assets/known-failures/animation.json by scripts/check-catalogue.mjs --write. Edit the JSON, not this file. -->

## Contents

- Frame callbacks
- Worklets
- Reanimated
- Skia
- Frame rate
- Gestures

## Frame callbacks

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `animation-frame-clock-reset` | The first animation runs; every later one freezes, then jumps to the end | Reanimated resets timeSinceFirstFrame to 0 whenever a frame callback is re-activated (verified in react-native-reanimated 4.5 FrameCallbackRegistryUI) | Record a start time from frame.timestamp on the first frame of each run and use timestamp - start; never timeSinceFirstFrame for an animation that restarts | verified |  | `skia-canvas-rendering` |
| `animation-frame-callback-throw` | A canvas freezes after an exception inside a frame callback | An uncaught error on the UI thread stops the callback silently | Wrap each frame body in one runner that catches, stops the callback and reports through scheduleOnRN, so the app pauses and records the error | verified |  | `skia-canvas-rendering` |
| `animation-frame-callback-idle` | The phone stays warm while nothing moves | A frame callback (or a Picture that reads the clock) keeps running every frame | Stop the frame callback when nothing animates; pause on background (useIsAppActive), focus loss and full-screen ads | documented |  | `performance-budgets` |

## Worklets

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `animation-runonjs-deprecated` | runOnJS logs a deprecation warning, or code written from memory uses runOnJS | react-native-worklets 0.10 deprecates runOnJS (@deprecated Use scheduleOnRN) | Use scheduleOnRN(fn, ...args) from react-native-worklets | verified (react-native-worklets >=0.10) |  | `motion-and-animation` |
| `animation-shared-value-access` | Shared value updates misbehave under the React Compiler, or the compiler lint flags .value | .value property access is not compiler-safe | Use .get() and .set() | verified |  | `motion-and-animation` |
| `animation-missing-worklet` | A crash on the UI thread when a gesture or frame callback calls a helper: "is not a worklet" or "Tried to synchronously call" | A function without the 'worklet' directive cannot run on the UI thread (a runtime error, not a build error) | Add 'worklet' (or a file-level directive for pure geometry modules) and test that UI-thread modules import only worklet modules | verified |  | `motion-and-animation` |
| `animation-worklet-closure-copy` | A worklet keeps using an old value after JS changed it | Values captured by a worklet are copied when it is first scheduled | Pass anything that changes through a shared value; no promises, await, setTimeout or third-party code inside worklets | documented |  | `motion-and-animation` |

## Reanimated

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `animation-spring-heavy` | withSpring feels heavy and slow after the Reanimated 4 upgrade | Reanimated 4's default spring is the 'gentle' config (mass 4, stiffness 900, damping 120), not Reanimated 3's mass 1 | Pass the spring config from the motion tokens explicitly on every withSpring | verified (react-native-reanimated 4.x) |  | `motion-and-animation` |
| `animation-reduced-motion-constant` | Changing Reduce Motion while the app runs has no effect on some animations | Reanimated's useReducedMotion is read once at module load | Read reduce motion through the app's a11y store (useReduceMotion) and a root ReducedMotionConfig | verified |  | `accessibility-as-code` |
| `animation-repeat-ignores-reduce-motion` | A decorative loop keeps moving with Reduce Motion on, and screenshots of that screen never settle | A withRepeat loop never reads the reduce-motion setting | Make the loop rest when useReduceMotion() is true (or pass ReduceMotion.System); screenshot tooling then gets a still screen too | verified |  | `motion-and-animation` |

## Skia

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `animation-skia-mutable-path` | Skia logs a deprecation warning for moveTo, addCircle or transform on an SkPath | Skia 2.6 moved to immutable paths built with Skia.PathBuilder; the old mutators still work but warn and will be removed | Build paths with Skia.PathBuilder.Make()...build() once, and place them with canvas save/translate/scale/restore | verified (@shopify/react-native-skia >=2.6) |  | `skia-canvas-rendering` |
| `animation-canvas-onlayout` | Canvas onLayout does not fire on the New Architecture | Canvas onLayout is deprecated on Fabric | Use onSize or useCanvasSize() | verified |  | `skia-canvas-rendering` |
| `animation-drawtext-arabic` | Arabic-script words drawn on a canvas render as broken, unjoined letters | canvas.drawText does no text shaping | Use a Skia Paragraph (ParagraphBuilder with TextDirection.RTL) for shaped text; drawText only for digits and Latin | verified |  | `skia-canvas-rendering` |
| `animation-paragraph-per-frame` | Frame drops when a canvas shows text | Building a Paragraph every frame is costly | Build on text or locale change and cache it; draw a retained Paragraph node | documented |  | `skia-canvas-rendering` |
| `animation-icon-even-odd` | Path icons render as filled blobs (rings and cut-outs filled in) | A path union comes back with the even-odd fill rule | Apply AsWinding after the union (or set the fill type explicitly) | verified |  | `icons-app-icon-and-splash` |

## Frame rate

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `animation-promotion-60hz` | Animations run at 60 Hz on a 120 Hz iPhone | Info.plist lacks CADisableMinimumFrameDurationOnPhone = true (an override removed what the SDK 57 prebuild template sets) | Keep the template value; the canvas checker reports an override | verified |  | `skia-canvas-rendering` |
| `animation-sim-60fps` | The iOS simulator never exceeds 60 fps; a 120 Hz loop measures about 116 ticks/s | The simulator is capped at 60 fps and its display-link timing differs | Count ticks, never wall time; check 120 Hz on a real high-refresh device | open |  | `performance-budgets` |
| `animation-90hz-misjudged` | A 90 Hz Android phone shows false hitches in frame measurements | The measurement assumed 120 Hz frame budgets on a 90 Hz display | Read the display's refresh rate and judge frames against its own budget (8.3, 11.1 or 16.7 ms) | verified | Android | `performance-budgets` |

## Gestures

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `animation-rngh-v3-migration` | Gesture callbacks never fire after a Gesture Handler 3 upgrade, or gestures cannot be composed | Gesture Handler 3 renames onStart to onActivate and onEnd to onDeactivate, merges onChange into onUpdate, and hook-based gestures cannot relate to builder gestures | Keep gestures behind one hook per surface and move all of its gestures to the new API in one commit | documented |  | `canvas-gestures-and-hit-testing` |
| `animation-slider-blocks-scroll` | A list does not scroll when a drag starts on a slider, and the value jumps | The slider's pan gesture had minDistance(0) | Race pan and tap: the pan activates after a few points sideways and fails after a few points vertically; check on a device | documented |  | `ui-component-library` |
| `animation-gesture-thresholds` | Swipes feel wrong or taps wait | Gesture thresholds and composition order were never validated on a device | Tune on a device; test Exclusive(pan, longPress, tap) so taps do not wait | open |  | `canvas-gestures-and-hit-testing` |
| `animation-gestures-rtl-android` | Gestures behave differently in right-to-left on Android | Gesture coordinates are physical; only iOS was probed | Run the gesture tests and a device check in RTL on Android before shipping RTL | open | Android | `canvas-gestures-and-hit-testing` |
