# Accessibility and testing

How a Lottie or Rive moment behaves for people who turn motion off or use a screen reader, how test
builds hold it still, what the Jest tests prove with the root mocks, and the device pass a person
runs. Read it when building a moment's screen, writing its tests, or preparing the release check.

## Contents

- Reduce Motion: the still frame
- Test mode is the same path
- Screen readers: decorative or informative
- Starting a moment from the right place
- The Jest mocks
- What to assert
- The device pass (human)

## Reduce Motion: the still frame

Neither runtime reads the system setting (runtimes-and-setup reference). `AnimationMoment` reads
accessibility-as-code's `useReduceMotion()`, which combines the phone's switch (iOS Settings >
Accessibility > Motion > Reduce Motion; Android Settings > Accessibility > Remove animations) with
the app's own "Reduce motion" setting, and turns the moment still:

- Lottie: `autoPlay={false}`, `loop={false}`, `progress` = the record's `reducedMotion.progress`.
- Rive: `autoPlay={false}` and `pause()`: the state machine rests on its first frame.
- `hidden` (decorative art only): nothing is drawn; the box keeps its size so the layout does not jump.

The end state must still be reachable with motion off (WCAG 2.3.3): a celebration's meaning (the
list is done) is also on screen as text or a state, never only in the animation.

## Test mode is the same path

Screenshots and E2E runs need every moment still. debug-menu-and-test-hooks' debug kit passes
preference `'on'` into `MotionConfig` while `motion=still` is set, so `useReduceMotion()` answers
true and `AnimationMoment` holds the still frame: one switch for Reanimated, Lottie and Rive.
Never add an "animations off for tests" flag to the moment; it would let a test pass while Reduce
Motion is broken.

## Screen readers: decorative or informative

- Decorative (`decorative: true`): the frame view sets `accessible={false}`,
  `accessibilityElementsHidden` (iOS VoiceOver) and `importantForAccessibility="no-hide-descendants"`
  (Android TalkBack), so neither reader stops on it. The information it decorates is said elsewhere
  (a heading, an announcement through `useAnnounce()`).
- Informative (`decorative: false`): one image with a translated `label` (`t()` in the model hook,
  i18n-strings-and-catalogs): `accessible`, `accessibilityRole="image"`, `accessibilityLabel`.
- Rive's own `semantics` prop exposes editor-authored semantics on the new iOS runtime only (Android
  is pending upstream, read in 0.5.5's specs); the templates leave it off and label the frame instead.
- An interactive Rive moment (it reacts to touch) also needs a tap or a named action that does the
  same thing (accessibility-as-code, gesture alternatives).

## Starting a moment from the right place

A celebration starts when the result is committed: the handler that checked off the last task sets
the state that shows `<ListCompletedBurst isActive>`, never a mount or focus effect that replays on
every remount (motion-and-animation's rule for celebrations; a Lottie celebration counts as one piece
there). `isActive` also turns false when the screen loses focus, which holds the still frame.

## The Jest mocks

Both runtimes are native views Jest cannot draw, so the skill ships root mocks (automatic in every
Jest project; copy them to `__mocks__/`):

| Mock | Renders | Read in a test |
|---|---|---|
| `__mocks__/lottie-react-native.tsx` | a host `LottieAnimationView` (testID `lottie.view`) with every prop | props through `getByTestId('lottie.view', { includeHiddenElements: true })`; ref calls in `lottieViewMethods` (jest.fn) |
| `__mocks__/@rive-app/react-native.tsx` | a host `RiveView` (testID `rive.view`) with every prop; `useRiveFile` loads at once; `useRive` is ready | props through `getByTestId('rive.view')`; `play()` / `pause()` calls in `riveViewCalls` (plain functions, because `restoreMocks` would empty a jest.fn's implementation and the player awaits them) |

Read the mock's extras through the same import the component uses
(`import * as RiveModule from '@rive-app/react-native'`): `jest.requireMock()` returns a separate
instance of a root mock, whose call log stays empty.

## What to assert

The template tests (`lottie-moment.test.tsx`, `rive-moment.test.tsx`, `animation-stage.test.tsx`,
`animation-playback.test.ts`) are the pattern; a feature's own test asserts what its moment adds:

- the moment plays while active and holds the still frame under `preference="on"`;
- a bounded run ends: call `onAnimationFinish(false)` once per play, then the end frame shows and
  `onFinish` ran once;
- decorative art is not found without `includeHiddenElements`; informative art is found by
  `getByRole('image', { name })`;
- a second heavy moment holds still while the first plays.

Jest cannot prove the frames, the frame rate, the real still frame or the size on screen; the device
pass does.

## The device pass (human)

Ask the developer for it before the release (Release builds, both platforms, named devices):

1. Build and launch on a named iOS simulator (`xcrun simctl boot "$UDID"`) and a named Android
   emulator (`emulator -avd <project>-<purpose>`), then on one real phone each.
2. Play each changed moment with motion on: it plays its plays and stops; leave the screen mid-play
   and come back; send the app to the background mid-play.
3. Turn Reduce Motion on (iOS: Settings > Accessibility > Motion; Android: Settings > Accessibility >
   Remove animations, or `adb -s <serial> shell settings put global transition_animation_scale 0`,
   which React Native 0.86.3 reads as Reduce Motion on Android, read in its AccessibilityInfoModule):
   the still frame shows and nothing moves.
4. With VoiceOver and TalkBack: decorative art is skipped; informative art reads its label once.
5. Watch for dropped frames during the moment (performance-budgets' frame report on a Release build).
