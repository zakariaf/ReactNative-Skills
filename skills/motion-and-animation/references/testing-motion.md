# Testing motion

How the motion templates are tested in Jest and how to test a moment of your own: fake timers,
the reduce-motion wrapper, reading shared values, proving the end state with motion reduced, an
interruption, a loop's stop conditions and a celebration's once-per-event rule. Verified on
2026-10-03 with Jest 29.7, jest-expo 57.0.5, React Native Testing Library 14.0.1 and Reanimated
4.5.1: the template tests here passed (51 related tests) in the reference app through
`verify-templates`.

## Contents

- The Jest setup Reanimated needs
- Fake timers drive animations
- The reduce-motion wrapper
- What to assert
- Recipes
- What Jest cannot prove

## The Jest setup Reanimated needs

unit-and-component-tests owns `jest.setup.ts`; its canonical copy already holds the two lines
Reanimated needs:

```ts
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
require('react-native-reanimated').setUpTests();
```

With them, animations run in Jest on timers: `withTiming`, `withSpring`, `withRepeat` and layout
builders advance with the fake clock, and `.get()` reads a shared value's current value.
`advanceAnimationByTime` and `withReanimatedTimer` are deprecated in 4.5.1 (they log a warning;
`node_modules/react-native-reanimated/src/jestUtils/index.ts`): use `jest.advanceTimersByTime`.

## Fake timers drive animations

```ts
beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

await act(() => {
  result.current.play('list-1');
  jest.advanceTimersByTime(plan.totalMs / 2);
});
```

Fake timers are fine in UI tests (`src/ui`, `src/features`); unit-and-component-tests'
`fake-timers-in-logic` rule keeps them out of the domain layers, which take an injected clock
instead. Advance inside `act()` (RNTL 14 is async: await it), and advance by token values
(`MOTION_MS.slow * 3`), never by a magic number.

## The reduce-motion wrapper

Hooks and components that read `useReduceMotion()` are rendered inside the real
`<MotionConfig preference>`; passing your own `wrapper` needs no `// no-providers:` marker:

```tsx
function withMotion(preference: ReduceMotionPreference) {
  return function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <MotionConfig preference={preference}>{children}</MotionConfig>;
  };
}
const { result } = await renderHook(() => useCelebration(BURST), { wrapper: withMotion('on') });
```

`preference="on"` also sets Reanimated's global mode, so a `withTiming` in the unit under test
finishes instantly, exactly as on a phone. For the phone's own switch, set the store before
rendering and inside `act()` afterwards: `systemA11yStore.setState({ isReduceMotionOn: true })`.
Reset it in `beforeEach`, never in `afterEach` (RNTL unmounts after your `afterEach`).

A screen test renders through `renderWithProviders` (unit-and-component-tests); add
`MotionConfig` to the app's `test/test-app.tsx` once the root layout mounts it, so screens are
tested under the same tree they run in.

## What to assert

- **Shared values**, read with `.get()`, for hooks (`result.current.elapsedMs.get()`).
- **Visible end states**, by role and text, for screens: the checked box, the removed row, the
  result text, with motion reduced and without.
- **Styles** only where the style is the contract (`src/ui`, `src/theme`; elsewhere
  `// allow-style-assertion: <why>`), for example `pointerEvents: 'none'` on a decorative layer.
- Not the frame-by-frame curve: tokens and the checker own the numbers.

## Recipes

**The end state is reached with motion reduced** (rule: motion decorates state):

```tsx
const view = await renderWithProviders(<TasksScreen />, { reduceMotion: 'on' });
await user.press(screen.getByRole('checkbox', { name: 'Buy milk' }));
expect(screen.getByRole('checkbox', { name: 'Buy milk' })).toBeChecked();
```

(`reduceMotion` is a test-app option the app adds next to its providers; until then, wrap the
screen in `withMotion('on')`.)

**An interruption turns around instead of snapping** (the `taskCheck` state moment, timed on
`fast`; both steps advance by fractions of that moment's own duration, read from the catalog):

```ts
const { duration = 0 } = timingOf(MOTION_MOMENTS.taskCheck); // MOTION_MS.fast
await act(() => {
  setDone(true);
  jest.advanceTimersByTime(duration / 2);
});
const midway = fill.get();
await act(() => {
  setDone(false);
  jest.advanceTimersByTime(duration / 4);
});
expect(fill.get()).toBeLessThan(midway);
expect(fill.get()).toBeGreaterThan(0);
```

**A loop stops** when the screen blurs, the app leaves the foreground, or reduce motion turns on
mid-loop: `templates/src/ui/motion/use-motion-loop.test.tsx` fakes `AppState` the way
react-components-and-hooks' `use-is-app-active.test.ts` does (set `currentState`, capture the
listener) and rerenders with `{ isFocused: false }`.

**A celebration plays once, skips, and shows its end state when reduced**:
`templates/src/ui/motion/use-celebration.test.tsx`.

**A screen animation follows the preference**: `screenAnimationFor` is pure; test it directly, and
the hook through the wrapper (`use-screen-animation.test.tsx`).

**A functional timer never shortens**: render the hold under `withMotion('on')`, advance by less
than `MOTION_MS.holdToConfirm` and assert nothing was confirmed; advance past it and assert it was
confirmed once.

## What Jest cannot prove

Feel, frame rate, the velocity hand-off, haptic timing and whether a reduced fade looks like a fade.
Those need the device pass in reduce-motion-and-interruption.md (release build, named simulator and
emulator, video with motion on and reduced). Frame-time budgets and dropped-frame measurement belong
to performance-budgets; pixel comparisons of a still frame belong to design-visual-parity.
