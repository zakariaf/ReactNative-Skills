# Reanimated 4 in practice

The APIs this skill's rules rest on, as they behave in the versions Expo SDK 57 bundles, with the
source file each fact was read in. Verified on 2026-10-03 against react-native-reanimated 4.5.1,
react-native-worklets 0.10.1, react-native-gesture-handler 2.32.0, react-native-screens 4.26.2 and
React Native 0.86.3 (read in the installed sources of the reference app). Re-verify:
`node -p "const b=require('expo/bundledNativeModules.json'); [b['react-native-reanimated'], b['react-native-worklets'], b['react-native-gesture-handler']].join(' ')"`
and the `grep` named next to each fact.

## Contents

- Setup on Expo SDK 57
- Two runtimes
- Choosing the tool
- Timing, spring and retargeting
- Callbacks and interruption
- Delay, sequence and repeat
- Layout animations
- CSS animations and transitions
- Gestures
- Which properties to animate
- Native stack transitions
- iOS and Android notes
- Troubleshooting

## Setup on Expo SDK 57

- Install through Expo so the versions match the SDK:
  `npx expo install react-native-reanimated react-native-worklets`. Expo's SDK 57 page says no
  Babel step is needed: `babel-preset-expo` configures the Worklets plugin when the package is
  installed (https://docs.expo.dev/versions/v57.0.0/sdk/reanimated/).
- Reanimated 4 runs on the New Architecture only, which is the only architecture the canonical
  stack builds.
- Judge feel in a release build on the slowest phone the app supports. A development build's JS
  thread is slow enough to hide the problems you are looking for, and Expo Go is not a performance
  environment.
- 120 Hz on ProMotion iPhones needs `CADisableMinimumFrameDurationOnPhone` in Info.plist; the
  Info.plist template in `@expo/config-plugins` 57.0.9 carries it
  (`grep -n CADisableMinimumFrameDurationOnPhone node_modules/@expo/config-plugins/build/plugins/withIosBaseMods.js`).
  Confirm it in the prebuilt `ios/<app>/Info.plist` (ios-simulator-build reads plists). The frame
  budget is then about 8 ms, not 16.

## Two runtimes

Worklets runs the React Native runtime (React, app logic) and a UI runtime that runs worklets every
frame. Motion stays smooth only while each frame's work stays on the UI runtime: shared values,
`useAnimatedStyle`, animation functions and gesture callbacks. Crossing back to React Native is
`scheduleOnRN(fn, ...args)` from `react-native-worklets`; `runOnJS`, `runOnUI` and
`executeOnUIRuntimeSync` are deprecated in favour of `scheduleOnRN`, `scheduleOnUI` and `runOnUISync`
(`grep -n deprecated node_modules/react-native-worklets/src/threads.native.ts node_modules/react-native-reanimated/src/workletFunctions.ts`;
check-motion `worklets-api`). Read and write shared values with `.get()` and `.set()`, never
`.value` (the form the React Compiler can see through; react-components-and-hooks owns that rule),
and never during render: in worklets, handlers and effects only. A function called from a worklet
starts with `'worklet'` (`pieceProgress` in `burst-piece.tsx`).

## Choosing the tool

Walk down and stop at the first that fits.

| Need | Tool | In this skill |
|---|---|---|
| A value changes and the view follows (a checkbox fill, a chip tint) | `useDerivedValue(() => withTiming(target, timingOf(m)))` | `examples/task-check.tsx` |
| Something mounts or unmounts, or a list reflows | layout animations: `entering`, `exiting`, `layout`, `itemLayoutAnimation` | `examples/task-list-row.tsx` |
| A finger moves it | `Gesture` + `GestureDetector` + a shared value, released with `springOf(m)` and the velocity | `examples/task-sheet.tsx` |
| It loops while something is true | `useMotionLoop(m, { isFocused })` | `examples/sync-badge.tsx` |
| A bounded flourish after a result | `useCelebration(m)` + `<CelebrationBurst>` or the app's end-state view | `examples/task-check-cell.tsx` |
| Screen to screen | the native stack's `animation`, from `useScreenAnimation()` | `examples/app-stack.tsx` |
| A two-state style change with no gesture | a Reanimated CSS transition, gated on reduce motion | `examples/due-chip.tsx` |
| A timer the person acts on | `withTiming` with `ReduceMotion.Never` in a functional moment | `examples/hold-to-delete.tsx` |
| A canvas scene or many drawn shapes | Skia timelines (skia-canvas-rendering) | — |

Never core `Animated` (the lint config bans it), never React Native's `LayoutAnimation`
(`reanimated-only`), never `PanResponder`.

Expo's `expo-animation` skill is a good broader API reference (recipes for sheets, swipe-to-delete,
collapsing headers, keyboard-synced views). Where it differs from this library, the library's
rules win: it reads Reanimated's `useReducedMotion()` (a startup constant here; use
`useReduceMotion()`), suggests `hitSlop` for small targets (accessibility-as-code wants a 44 pt box)
and leaves loops and celebrations to the component (here they go through `useMotionLoop` and
`useCelebration`).

## Timing, spring and retargeting

- Assigning a new animation to a shared value starts it from the value's current position: a
  second tap mid-animation turns the motion around instead of jumping
  (`node_modules/react-native-reanimated/src/valueSetter.ts`: `onStart(animation, mutable.value, ...)`).
- `withSpring` takes the previous animation's velocity when it replaces one
  (`src/animation/spring/spring.ts`, `previousAnimation?.velocity`), so a spring interrupted by a
  spring keeps its momentum. A gesture release passes `velocity: event.velocityY` explicitly
  (`gesture-velocity`).
- `withTiming` retargeted to the same `toValue` keeps its start time (`src/animation/timing.ts`,
  `previousAnimation.toValue === toValue`).
- Resetting first (`x.set(0); x.set(withTiming(1))`) throws all of that away: an interrupted
  animation snaps to the start (`no-reset-before-animate`). The motion primitives may reset (a
  celebration replays from its first frame on purpose); feature code does not.
- Spring configs come complete from `SPRINGS` (damping, stiffness, mass): Reanimated 4.5.1's default
  mass is 4 (`grep -n -A4 GentleSpringConfig node_modules/react-native-reanimated/src/animation/spring/springConfigs.ts`).

## Callbacks and interruption

When a running animation is replaced or cancelled, its callback runs with `finished === false`
(`src/valueSetter.ts`: `previousAnimation.callback?.(false)`). So work placed in a completion
callback silently never happens when the person interrupts: a row "removed after its exit fades"
stays in the list forever. Commit state in the handler first and let the animation follow; exits
are `exiting={...}` layout animations, which run after React has already removed the view
(`commit-before-motion`). The one exception is a functional timer, whose completion is the commit
(hold to delete).

`cancelAnimation(sv)` stops an animation where it is. `useAnimatedReaction(prepare, react)` is the
place to cross to JS when a value crosses a threshold (a snap point reached), once, not per frame.

## Delay, sequence and repeat

Read in `src/animation/delay.ts`, `sequence.ts` and `repeat.ts`:

| Function | Under reduced motion |
|---|---|
| `withDelay(ms, anim)` | the delay is skipped (`now - startTime >= delayMs \|\| animation.reduceMotion`) |
| `withSequence(...anims)` | every step but the last is skipped, the last one is instant |
| `withRepeat(anim, n, reverse)` | runs one repetition, instant; a reversing repeat with an even or endless count does not start at all |

A reversing `withRepeat` with an **odd** count ends at the far value, with motion on (0 → 10 → 0 →
10) and under reduced motion (the single instant repetition lands on 10). A shake therefore ends at
rest explicitly: `withSequence(withTiming(-d, step), withRepeat(withTiming(d, step), 4, true),
withTiming(0, step))`, which under reduced motion jumps straight to its last step, 0.

The reduce-motion decision is taken **once, when the animation starts** (`decorateAnimation` sets
`animation.reduceMotion` in `onStart`, `src/animation/util.ts`). A `withRepeat(..., -1)` already
running when the person turns reduce motion on keeps looping. That is why loops go through
`useMotionLoop`, whose effect cancels and restarts them when the answer changes
(`loop-through-hook`).

A JavaScript timer gets none of this: `setTimeout(() => sv.set(withSpring(1)), 700)` waits 700 ms
under reduced motion, drifts from the frames, and fires after the component unmounted
(`no-timer-sequencing`). Delays and stagger are `withDelay(delayOf(m) + staggerOf(m, i), ...)`.

## Layout animations

- `entering`, `exiting` and `layout` on an `Animated.*` component; builders from Reanimated
  (`FadeIn`, `FadeInDown`, `FadeOutUp`, `LinearTransition`, `Keyframe`). Their duration comes from
  the moment: `FadeInDown.duration(ENTER.duration ?? 0)` with `const ENTER = timingOf(m)`.
- They follow the root reduce-motion mode: the builder's `reduceMotionV` defaults to
  `ReduceMotion.System` and is resolved with `getReduceMotionFromConfig`
  (`src/layoutReanimation/animationBuilder/BaseAnimationBuilder.ts`). Under reduced motion they are
  instant; a moment that declares `fade` uses `reducedEntering()` / `reducedExiting()`.
- `<LayoutAnimationConfig skipEntering>` around a list stops every row animating in on the first
  render (`src/component/LayoutAnimationConfig.tsx`); new rows added later still enter.
- `Animated.FlatList`'s `itemLayoutAnimation` animates the reflow when rows come and go
  (`src/component/FlatList.tsx`). Do not put `entering` on rows of a recycling list (FlashList):
  a recycled row re-enters as it scrolls in. Animate the container or use the list's own layout prop.
- **A layer without a `Modal` fade.** ui-states-and-feedback's `ConfirmDialog` renders on iOS in
  react-native-screens' overlay window (`AboveModalScreens`) instead of a `Modal`, so it appears
  without `animationType="fade"` (Android keeps the `Modal` fade, `none` under reduce motion). An
  app that wants an entering moment there wraps the scrim and card in an `Animated.View` with
  `entering={isReduced ? reducedEntering() : FadeIn.duration(ENTER.duration ?? 0)}` from a moment of
  its catalog, in its own copy of that file; the dialog's tests and testIDs stay as they are.
- Shared element transitions sit behind the static feature flag `ENABLE_SHARED_ELEMENT_TRANSITIONS`,
  off by default in 4.5.1 (`src/featureFlags/staticFeatureFlags.ts`); this skill does not use them.

## CSS animations and transitions

Reanimated 4 accepts CSS-style keys on `Animated.*` styles: `transitionProperty`,
`transitionDuration`, `transitionTimingFunction`, `animationName` (keyframes), `animationDuration`,
`animationIterationCount`. Curves use `cubicBezier(x1, y1, x2, y2)` from `react-native-reanimated`
(`src/css/easing/index.ts`); `Easing.bezier` belongs to `withTiming`.

**They ignore every reduce-motion setting.** Nothing under `src/css/` nor the C++ CSS engine
(`Common/cpp/reanimated/CSS/`) reads reduce motion
(`grep -rli reducemotion node_modules/react-native-reanimated/src/css` prints nothing), and
`ReducedMotionConfig` only feeds the animation functions and layout animations. So the condition
sits on the key: `transitionProperty: isReducedMotion ? 'none' : 'backgroundColor'`
(`css-motion-reduced`); an endless `animationIterationCount: 'infinite'` is a loop and goes through
`useMotionLoop` instead (`loop-through-hook`). Durations are tokens
(`transitionDuration: TINT.duration`); design-system-structure's `no-raw-duration` flags raw numbers.

A transition needs no `transitionProperty` to run: with only `transitionDuration` set, Reanimated
4.5.1 transitions `'all'` (`src/css/native/normalization/transition/config.ts`), and the `transition`
shorthand (`transition: 'backgroundColor 240ms'`, `shorthand.ts`) works too. So
`css-motion-reduced` also fails a `transition` value without the condition and a
`transitionDuration` with neither `transitionProperty` nor `transition` in the same style object
(unless its own value is gated: a duration of 0 skips the transition). Limit: the style object is
read as written, so a `transitionProperty` that arrives through a spread (`{ ...base,
transitionDuration }`) is not seen; write it in the object that sets the duration.

## Gestures

- Gesture Handler 2.32: `Gesture.Pan()`, `.onBegin`, `.onUpdate`, `.onEnd`, `.onFinalize` (worklets
  when Reanimated is installed), `GestureDetector`. The app root needs `GestureHandlerRootView`
  (Gesture Handler's documentation); in expo-router 57.0.24 only the JS stack view wraps one
  (`grep -rln GestureHandlerRootView node_modules/expo-router/build`), not the native `Stack`.
- The finger and the release spring write the same shared value, so a new touch catches a settling
  sheet where it is (no reset, no lock).
- Per-frame callbacks (`onUpdate`, `onChange`, `onTouchesMove`) never call `scheduleOnRN` or a React
  setter: at 120 Hz that is 120 React renders a second (`no-js-per-frame`). Commit in `onEnd`, once.
- Committing in `onEnd` means the close callback runs while the closing spring still moves. If the
  parent unmounts the sheet in that callback, the view vanishes mid-spring. The parent then renders
  the sheet inside an `Animated.View` with `exiting={isReducedMotion ? reducedExiting() : SlideOutDown.duration(...)}`
  (the layout animation starts from where the finger left it, timed from the moment's tokens), or
  keeps the sheet mounted until the next open. Moving the commit into the spring's callback is the
  wrong fix (`commit-before-motion`).
- Dismissal thresholds use distance or velocity, so a flick is enough
  (`event.velocityY > height` in `examples/task-sheet.tsx`).
- Only Pan (`velocityX`, `velocityY`), Pinch and Rotation (`velocity`) end events carry a velocity;
  Tap, LongPress, Fling, ForceTouch, Native, Manual and Hover events do not
  (`node_modules/react-native-gesture-handler/src/handlers/GestureHandlerEventPayload.ts`, 2.32,
  verified 2026-10-03). `gesture-velocity` therefore applies to a spring in the `onEnd` /
  `onFinalize` of a chain that starts at `Gesture.Pan()`, `Gesture.Pinch()` or `Gesture.Rotation()`,
  or of a variable bound to one in the same file; a press-scale on `Gesture.Tap()` springs back
  without one. Limit: a gesture built in another file or passed as a prop cannot be followed, and
  the rule stays silent there.
- Every gesture-only action also has a tap or a named accessibility action (accessibility-as-code).
  Canvas gestures turned into commands belong to canvas-gestures-and-hit-testing.

## Which properties to animate

`transform` and `opacity` are composited: no layout pass. `width`, `height`, `top`, `left`, `start`,
`end`, `margin*`, `padding*`, `flex*`, `gap`, `borderWidth`, `fontSize` re-run Yoga for the node and
its siblings on every frame (`compositor-props`). The exception is an absolutely positioned element
with no children (a progress fill), where `scaleX` would smear its rounded end: keep `width` and
write `// motion-layout: <reason>` on the line above. Size changes of laid-out content use
`layout={LinearTransition.duration(...)}`. Never start an entrance from `scale: 0` (start from about
0.95 with opacity 0); `transform` is an ordered list (translate before scale unless the scale should
grow the offset). On Android, animating `elevation` or a blur re-renders it every frame: fade a
pre-shadowed layer instead (design-system-structure bans legacy shadow keys anyway).

## Native stack transitions

Expo Router's `Stack` is react-native-screens' native stack. Its `animation` option takes
`'default'`, `'fade'`, `'fade_from_bottom'`, `'flip'`, `'none'`, `'simple_push'`,
`'slide_from_bottom'`, `'slide_from_right'`, `'slide_from_left'`, `'ios_from_right'`,
`'ios_from_left'` (`StackAnimationTypes`, `node_modules/react-native-screens/src/types.tsx`).
react-native-screens 4.26.2 has no reduce-motion handling at all
(`grep -rli reducemotion node_modules/react-native-screens/ios node_modules/react-native-screens/android/src node_modules/react-native-screens/src`
prints nothing), and neither does expo-router's build. So every `<Stack>` takes
`screenOptions={{ animation: useScreenAnimation() }}`, and a screen that slides takes
`useScreenAnimation('slide_from_bottom')`: a cross-fade replaces the movement while motion is
reduced (`screen-transition-reduced`). The checker accepts `screenOptions={options}` when the file
calls `useScreenAnimation()` (or `screenAnimationFor`), and a stack whose only animation is
`'none'` (nothing moves). Expo Router's `Tabs` take `'fade'`, `'shift'` (a fade with a small offset) or `'none'` (`TabAnimationName` in `node_modules/expo-router/build/react-navigation/bottom-tabs/types.d.ts`), which
`useScreenAnimation()` does not return: gate them directly,
`animation: isReducedMotion ? 'none' : 'shift'` with `useReduceMotion()`. Whether iOS's own push changes under the system Reduce
Motion switch is not verified here; the hook makes the app's answer explicit either way. Look at the
interactive swipe-back on iOS with `animation: 'fade'` on a device before shipping.

## iOS and Android notes

- **The switches.** iOS: Settings > Accessibility > Motion > Reduce Motion. Android: Settings >
  Accessibility > Remove animations, which sets the global animation scales to 0 (Android's
  documentation); React Native's
  `AccessibilityInfo` and Reanimated both read `Settings.Global.TRANSITION_ANIMATION_SCALE == 0`
  (`node_modules/react-native-reanimated/android/src/main/java/com/swmansion/reanimated/NativeProxy.kt`,
  `getIsReducedMotion`). Turning animations off in Developer options counts too.
- **Reanimated reads the system value once**, at startup (`_REANIMATED_IS_REDUCED_MOTION`,
  `src/ReducedMotion.ts`); `useReducedMotion()` returns that constant. The live answer is
  accessibility-as-code's `useReduceMotion()` and `<MotionConfig>`.
- **Stack screens stay mounted** under the screen pushed on top, so their loops keep running unless
  something stops them (`useIsFocused()` from expo-router, used by `useMotionLoop`).
- **App state.** iOS reports `inactive` for the app switcher, Control Center and incoming calls,
  then `background`; Android reports only `active` and `background`. `useIsAppActive()`
  (react-components-and-hooks) is false for both.
- **Predictive back** (Android, `predictiveBackGestureEnabled` in the SDK 57 template) shows the
  previous screen during the gesture; a loop on that screen restarts when focus returns.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Failed to create a worklet` | the Worklets Babel plugin did not run: `babel-preset-expo` must be the preset (it adds the plugin); a bare app adds it last |
| Dev log: "Reduced motion setting is overwritten with mode ..." | expected once: `MotionConfig` set the global mode (`src/component/ReducedMotionConfig.tsx`) |
| Dev log: "Reduced motion setting is enabled on this device" | the phone reduces motion; animations with the default mode finish instantly (`src/animation/util.ts`) |
| A loop keeps running after Reduce Motion is turned on | it was started before the switch and runs outside `useMotionLoop` |
| A row never disappears after its exit animation | state was removed in a completion callback that got `finished: false`; remove it in the handler and use `exiting` |
| Gestures do nothing, no error | no `GestureHandlerRootView` around the app |
| A spring overshoots far more than designed | a partial spring config inherited mass 4; use a `SPRINGS` token |
