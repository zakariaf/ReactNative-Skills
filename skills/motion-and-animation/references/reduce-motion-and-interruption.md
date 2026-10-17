# Reduce motion and interruption

Where the app's one reduce-motion answer comes from, which animations it reaches by itself and
which must read it, how each kind of moment degrades, and how motion stays interruptible so it
never stands between the person and the next touch. Verified on 2026-10-03 against Reanimated 4.5.1,
react-native-screens 4.26.2 and React Native 0.86.3 (sources read in the reference app; the
re-verify commands are in reanimated-4-in-practice.md).

## Contents

- One answer, owned by accessibility-as-code
- Wiring the root
- What the root reaches, and what it does not
- Each kind in code
- The reduced fade, the one sanctioned opt-out
- Loops: three stop conditions
- Interruption
- Motion is never the state
- Trying it on devices
- Screenshots and E2E with motion held still

## One answer, owned by accessibility-as-code

`useReduceMotion()` (`src/ui/a11y/use-reduce-motion.ts`) resolves the in-app preference (`system`,
`on`, `off`, given to `<MotionConfig preference>`) against the phone's live switch mirrored by
`systemA11yStore`. Every animation decision in the app reads that one answer. Reanimated's
`useReducedMotion()` is banned there (a constant captured at startup; accessibility-as-code's
`reduce-motion` rule); so is reading `AccessibilityInfo` in a screen. This skill ships synced copies
of those files in `templates/src/ui/a11y/` for an app that does not have them yet; never edit them
here.

## Wiring the root

Two things, once (`reduce-motion-root`):

1. **Start the store.** In the root layout's mount effect:
   `useEffect(() => watchSystemA11y((error) => errorLog.record('startup', error)), [])`. Without it
   the store keeps its initial `false` forever and `useReduceMotion()` never sees the phone.
2. **Mount `<MotionConfig preference={...}>`** around the navigator: `"system"` until the app has a
   "Reduce motion" setting, then the saved preference (settings-and-preferences). It sets
   Reanimated's global mode (`ReducedMotionConfig` with `ReduceMotion.Always` or `Never`), so every
   animation that keeps the default `ReduceMotion.System` follows the setting and live changes.
   Anything that reads `useReduceMotion()` or `useScreenAnimation()` must render below
   `<MotionConfig>`, never in the component that mounts it: React context flows down only, so
   that component reads the context from above the provider, gets the `'system'` default and
   ignores an in-app "on" or "off". Split it in two, as `examples/root-stack.tsx` (`RootStack`
   mounts the providers) and `examples/app-stack.tsx` (`AppStack`, below them, calls
   `useScreenAnimation()`) do: two files, because the lint allows one component per file.
   check-motion flags a component body that both renders `<MotionConfig>` and calls one of those
   hooks (`reduce-motion-root`); it matches those two names only, so an app hook that wraps one
   of them and is called in the mounting component is a review item.

check-motion looks for both in the root layout and in the files it imports, three levels deep (the
JSX depth limit often pushes `MotionConfig` into the component the layout renders, as
`examples/root-stack.tsx` does). With React Navigation instead of Expo Router, point
`--root-layout` (or `motionRootLayout`) at `App.tsx`.

## What the root reaches, and what it does not

| Animation | Follows the root `MotionConfig`? | So the code... |
|---|---|---|
| `withTiming`, `withSpring`, `withDecay` (default `ReduceMotion.System`) | yes: finishes instantly at its target | nothing to write for `instant` |
| `withDelay`, `withSequence`, `withRepeat` | yes: delay skipped, last step only, one repetition | nothing to write |
| Layout animations (`entering`, `exiting`, `layout`, `Keyframe`) | yes: instant | `reducedEntering()` / `reducedExiting()` for `fade` |
| A loop started before the switch turned on | **no**: the decision was taken at its start | loops only through `useMotionLoop` |
| Reanimated CSS animations and transitions | **no**: no reduce-motion handling in 4.5.1 | the condition on the key (`css-motion-reduced`) |
| Native stack transitions (react-native-screens) | **no**: no reduce-motion handling in 4.26.2 | `animation: useScreenAnimation()` (`screen-transition-reduced`) |
| React Native's `LayoutAnimation` | **no** | banned (`reanimated-only`) |
| Skia canvas timelines | **no** (not Reanimated animations) | the reduced timeline (skia-canvas-rendering) |
| A JavaScript timer that starts an animation | **no**: the timer still waits | banned (`no-timer-sequencing`) |
| Lottie, animated images (expo-image `autoplay` of a WebP/GIF), looping video | **no**: none of them reads Reanimated's config | `autoPlay`/`autoplay={!isReducedMotion}` (or show the poster or last frame); a celebration's Lottie plays from `useCelebration`'s `play()` and counts as `pieces: 1` within `CELEBRATION_LIMITS`. Not checked by check-motion: a review item |

## Each kind in code

- **feedback.** The shared press surface already does it: under reduced motion a shrink becomes a
  dim and a sink loses its squash (`pressLookOf` in design-system-structure's press surface); the
  release spring is instant through the root. A rejection shake declares `none`: drop the shake,
  keep the message.
- **state.** `useDerivedValue(() => withTiming(target, timingOf(m)))`: instant through the root.
- **transition.** Layout animations: `entering={isReduced ? reducedEntering() : FadeInDown.duration(...)}`;
  native stack: `useScreenAnimation()`; a sheet's settle spring: instant through the root.
- **attention.** `useMotionLoop` rests at phase 0 while reduced; pair the static state with a busy
  text or `accessibilityState.busy` so the meaning survives without the motion.
- **celebration.** `useCelebration` jumps to the end state; `<CelebrationBurst>` draws nothing (a
  burst's alternative is `none`); a `static` celebration (stars) draws its end state at once.
- **functional.** `reduceMotion: ReduceMotion.Never` on the timer, in a file whose moment is
  `functional` (`reduce-motion-opt-out`), and a screen-reader alternative for the hold.

## The reduced fade, the one sanctioned opt-out

A moment that declares `fade` must really fade, but the root config would finish any default
animation instantly. `REDUCED_FADE` (`{ duration: MOTION_MS.reducedFade, easing: Easing.linear,
reduceMotion: ReduceMotion.Never }`) and `reducedEntering()` / `reducedExiting()` in
`src/ui/motion/moment-config.ts` carry the opt-out in one place. Apply them to opacity only: a
reduced fade that still translates is motion with a new name. Anywhere else, `ReduceMotion.Never`
fails `reduce-motion-opt-out`.

## Loops: three stop conditions

A loop runs on the UI thread until something stops it, and nobody notices the battery it burns.
`useMotionLoop(moment, { isFocused })` runs it only while:

1. **the screen is focused** (`useIsFocused()` from expo-router; React Navigation 7:
   `@react-navigation/native`): a pushed screen keeps the one below mounted, loops included;
2. **the app is active** (`useIsAppActive()`, react-components-and-hooks' shared hook): iOS
   `inactive` (app switcher, Control Center, a call) and `background`, Android `background`;
3. **motion is not reduced**, re-evaluated live: the effect cancels a running loop when the answer
   turns, because Reanimated would not.

`loop-through-hook` reads the repeat count of every `withRepeat` outside `src/ui/motion/`: a
literal `-1`, `0` or `Infinity`, or a constant declared in the same file with one of those values
(`const LOOP_FOREVER = -1`). It reads a CSS `animationIterationCount` the same way: the literal
`'infinite'` or a same-file constant holding it (`const ITERATIONS = 'infinite'`). Limit: a count
imported from another module, or arriving through a spread style, is not followed, so keep endless
counts out of shared constants and play loops through `useMotionLoop`.

A loop never conveys pressure (a hurry-up pulse near a deadline) and never runs on a screen whose
content is static. Frame-callback loops (`useFrameCallback`) belong to skia-canvas-rendering and
realtime-game-loop, which own their own stop conditions.

## Interruption

- **Retarget, never reset.** A new animation starts from the current value; a spring keeps its
  velocity. `x.set(start)` right before `x.set(withTiming(...))` snaps an interrupted animation back
  (`no-reset-before-animate`).
- **The finger wins.** A gesture writes the shared value the release animation writes, so a touch
  catches the motion mid-flight; the release spring takes `event.velocityX/Y`
  (`gesture-velocity`).
- **No lock.** Never `disabled={isAnimating}`, `pointerEvents={isCelebrating ? 'none' : 'auto'}` or
  `onPress={isTransitioning ? undefined : handlePress}` (`no-input-lock`). A tap during a
  celebration calls `skip()` or simply does its job; a tap during a transition retargets it.
  Decorative layers take no touch at all (`pointerEvents: 'none'` in their style, as
  `<CelebrationBurst>` does).
- **Same-frame acknowledgement.** Press feedback starts on press-in, before any async result: a
  control that waits for the network before showing anything reads as a missed tap, and the person
  taps again.

## Motion is never the state

Commit the new state in the handler, then let the animation show it. Never put the commit in a
completion callback (`commit-before-motion`): an interrupted animation calls back with
`finished: false` and the commit never happens; under reduced motion the order changes; and a
remount replays it. Deleting a row removes it from state at once and its `exiting` animation plays
from the view React already dropped. The one exception is a functional timer, whose completion is
the commit (hold to delete). A test proves it: with `<MotionConfig preference="on">` the screen
reaches the same end state at once (testing-motion.md).

## Trying it on devices

Jest proves logic and end states; feel, frame rate and haptic timing need a device. Ask the
developer for this pass on a release build, on a named iOS simulator and a named Android emulator
(never "the booted one"; ios-simulator-build and android-emulator-build build and launch them):

- iOS: Settings > Accessibility > Motion > Reduce Motion in the simulator's Settings app.
  `xcrun simctl ui <udid>` offers appearance, increase_contrast and content_size but no reduce-motion
  option in Xcode 26.6 (verified with `xcrun simctl help ui`).
- Android: `adb -s <serial> shell settings put global transition_animation_scale 0` (the value React
  Native and Reanimated read), plus `window_animation_scale` and `animator_duration_scale` for the
  whole "Remove animations" effect; restore `1` afterwards (Android's `settings` command). Flip it
  with the app running: React Native 0.86's `AccessibilityInfoModule.kt` registers a
  `ContentObserver` on `TRANSITION_ANIMATION_SCALE` and fires `reduceMotionChanged` live, so
  `watchSystemA11y` and `<MotionConfig>` update the answer without a relaunch (verified in source,
  2026-10-03: `grep -n ContentObserver node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/accessibilityinfo/AccessibilityInfoModule.kt`).
  Confirm that a running loop stops and the next push cross-fades without relaunching; a moment that
  only changes after a relaunch reads Reanimated's startup constant (Reanimated's own
  `useReducedMotion()`) instead of `useReduceMotion()`, which is the bug to fix.
- For each changed moment: record a video with motion on and with motion reduced, tap mid-animation
  on purpose, flick a sheet, leave and re-enter the screen during a loop, background the app during
  a loop, and feel each haptic once per event on a real phone (simulators and emulators do not
  reproduce haptics).

## Screenshots and E2E with motion held still

Screenshot comparison (design-visual-parity) and E2E flows (e2e-maestro) need animations at rest.
Never add a second switch for it: the test-only setup (debug-menu-and-test-hooks) launches the app
with `<MotionConfig preference="on">`, and every moment holds still through the path real users
take. Loops then rest, celebrations show their end state, native stacks cross-fade.
