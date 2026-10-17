# Testing canvas input

How input is proven in Jest without a device, the traps of the Gesture Handler and Worklets test
mocks, and what to check by hand on a named iOS simulator and a named Android emulator.

## Contents

- Test set-up
- What each test proves
- Driving a gesture
- Traps in the mocks
- On devices

## Test set-up

The canonical `jest.setup.ts` (unit-and-component-tests owns it) already holds the three lines input
tests need (verified with Gesture Handler 2.32.0, Worklets 0.10.1, Reanimated 4.5.1):

```ts
import 'react-native-gesture-handler/jestSetup';

jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
require('react-native-reanimated').setUpTests();
```

Gesture tests render a small probe, not the Skia canvas (Skia's native module does not load in the
`unit` project): `canvas-gesture-probe.tsx` wires `useCanvasGestures` to a plain `View`, and
`stick-gesture-probe.tsx` does the same for `makeStickGesture`. The gesture hook takes its layout and
callbacks as arguments, so its test renders with plain `render` and carries the reasoned
`// no-providers: ...` marker (unit-and-component-tests).

## What each test proves

| Test | File | Proves |
|---|---|---|
| `classifySwipe` examples | `src/canvas/gestures/classify-swipe.test.ts` | dominant axis → physical direction, a fast short flick accepted, too short and slow or too diagonal rejected, per-surface thresholds |
| `panIntent` examples | `pan-intent.test.ts` | each pan mode yields the right single intent; a drag that did not start on a region yields nothing; a lifted drag drops on the cell above the finger, lifting only y by exactly `dragLiftPt` |
| `stickCommand` property | `stick-command.test.ts` | dead zone, the four axes, every command within 11.25° of the drag |
| Touch-target helpers | `touch-targets.test.ts` | the smallest cell, edge rows, a lift that fits and one that strands the last row |
| Gestures end to end | `use-canvas-gestures.test.tsx` | tap → cell with `selected: null`; a miss → `onMiss` and no intent; drag → ONE drag-end; a cancelled drag → nothing; swipe → ONE direction; hover on change only; a lifted drag's hover and drop on one cell; long press → cell; stick writes each new command once and 0 on lift |
| Legality | `<surface>/intent-to-action.test.ts` | the surface's intents map to actions the domain lists, or `null` (also in a finished state and for taps inside `SELECT_REGIONS`) |
| Touch targets | `<surface>/hit-targets.test.ts` | the smallest hit region is at least `MIN_TOUCH_PT` on the smallest canvas; with a lift, every edge row reachable on portrait and wide canvases |
| Layout round trip | `<surface>/layout-<id>.test.ts` (skia-canvas-rendering) | `hitTest(cellRect(c)) = c` at any size, mirrored or not |
| Preview position | `<surface>/draw-<id>.test.ts` (skia-canvas-rendering) | the drag preview is drawn on `frame.fx.pointer.hover`, never offset |

## Driving a gesture

```tsx
import { act, render } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

await render(<CanvasGestureProbe layout={LAYOUT} panMode="drag" onIntent={onIntent} />);
await act(() => {
  fireGestureHandler(getByGestureTestId('canvas.pan'), [
    { state: State.BEGAN, x: 25, y: 25, translationX: 0, translationY: 0 },
    { state: State.ACTIVE, x: 40, y: 25, translationX: 15, translationY: 0 },
    { state: State.ACTIVE, x: 125, y: 175, translationX: 100, translationY: 150 },
    { state: State.END, x: 125, y: 175, translationX: 100, translationY: 150, velocityX: 0, velocityY: 0 },
  ]);
});
expect(onIntent).toHaveBeenCalledTimes(1);
```

- `getByGestureTestId` finds a gesture by its `.withTestId(...)`; every builder has one.
- Wrap `fireGestureHandler` in `await act(...)`: the Worklets Jest mock delivers `scheduleOnRN` as a
  microtask, and `act` flushes it. RNTL 14's `render` and `act` are async: `await` them.
- Assert `toHaveBeenCalledTimes(1)` for pans: the rule is at most one intent per gesture.
- End a sequence with `State.CANCELLED` (or `State.FAILED`) to prove a cancelled gesture emits nothing.
- A typed helper keeps the end state flexible: `last: State = State.END` (`State` is a value and a type
  in Gesture Handler 2.32).

## Traps in the mocks

- **Sequences are completed for you.** `fireGestureHandler` fills in missing states, so a list that
  stops at `ACTIVE` still ends the gesture (and runs `onFinalize`). To observe intermediate values,
  record every write instead of reading the final value.
- **Shared values from the mock are frozen objects.** `jest.spyOn(sharedValue, 'set')` throws "Cannot
  assign to read only property 'set'". Pass a stand-in object with `get`/`set` that records writes (the
  stick test does).
- **The first `ACTIVE` event runs `onStart` only; `onUpdate` runs from the second `ACTIVE` event on**
  (verified with the 2.32 Jest mock: `BEGAN, ACTIVE(10), ACTIVE(20), END` gives `onStart(10)` then
  `onUpdate(20)`). A test that needs an update (hover, stick command) sends at least two `ACTIVE`
  events. Put what must happen once per gesture in `onStart`/`onEnd`, never in `onUpdate`.
- **Hover calls go to JS on change only:** a drag across three cells calls `onHover` once per new cell,
  not once per event. The Jest test "hover on change only" in `use-canvas-gestures.test.tsx` is the
  proof. The checker's `hover-on-change` rule is a heuristic: it fails an `onUpdate`/`onChange` that
  calls `scheduleOnRN` with no `isSameTarget(` anywhere in its body, but it does not prove the call sits
  behind that guard (`const hasMoved = !isSameTarget(...)` left unused, with the `&& hasMoved` dropped
  from the `if`, still passes it; lint's `no-unused-vars` usually catches that edit). Keep the test, and
  never weaken it to match a change in the callback.
- **The 3.x mock may differ.** After a Gesture Handler major, re-read its testing guide and fix tests
  only where the testing API changed, never to make a behaviour pass (gesture-handler-versions.md).

## On devices

Jest proves the logic of the pipeline; a Release build proves that real touches reach the canvas
(verified for a point tap from Maestro on the iOS simulator in the source app). Several sessions may
share one machine, so every command names its device:

- **iOS:** create (or reuse) a simulator named `<project>-canvas` and use its UDID:
  `xcrun simctl boot <udid>`, run the Release build on it, and drive flows with
  `maestro --device <udid> test .maestro/flows/<flow>.yaml` (e2e-maestro). Test on iOS 26: swipe right
  across a pushed canvas screen and check the canvas, not the back gesture, gets it.
- **Android:** start an emulator by AVD name (`emulator -avd <project>-canvas`), find its serial with
  `adb devices`, and drive it with `maestro --device <serial> test ...` or
  `adb -s <serial> shell input tap <x> <y>` / `adb -s <serial> shell input swipe <x1> <y1> <x2> <y2> 300`
  (physical pixels: points × density ÷ 160, density from `adb -s <serial> shell wm density`). Turn on
  gesture navigation (Settings → System → Gestures) and start swipes near the edges.
- **Both:** tap the outer cells, drag onto the first and last rows, cancel a drag half-way (slide off the
  canvas, or pull down the notification shade) and check no preview stays behind, try tap-then-tap,
  switch to an RTL locale and tap a mirrored surface's first column, and reach every hold-only action
  without holding, with VoiceOver and with TalkBack.
