# Component and hook tests with React Native Testing Library 14

How every component, screen and hook of the app is tested: inside the app's real providers, by role
and accessible name, with every call awaited. Read this before writing any `*.test.tsx`.

## Contents

- The async model of RNTL 14
- The render helper and test/test-app.tsx
- Queries: which one to use
- Matchers
- Pressing, typing and waiting
- Accessible names built by the catalog (bidi isolates)
- Hooks
- Stores and services in tests
- Routes and navigation (Expo Router)
- Gestures, Skia and direction
- Android behaviour
- Style assertions: only where the style is the contract
- Tests that render without the providers (the no-providers marker)
- What not to test
- Good and bad patterns side by side
- Appendix: when the app uses React Navigation 7 (static API)

## The async model of RNTL 14

RNTL 14 adopts React 19's async rendering: `render()`, `rerender()`, `unmount()`, `renderHook()`,
every `fireEvent` helper and `act()` return promises. So:

- **Await every** `render`, `renderHook`, `rerender`, `unmount`, `fireEvent*`, `act`, `waitFor`,
  `waitForElementToBeRemoved`, `findBy*`, every `user.*` call and the render-helper functions
  (`renderWithProviders`, `renderHookWithProviders`), and make each test function `async`. An un-awaited call runs after the
  assertions and produces `act(...)` warnings or tests that pass for the wrong reason.
- Do not wrap `render` or presses in `act()` yourself; they handle it. Use `await act(() => { ... })`
  only to change state from outside React (a store action, a fake port's event).
- `@typescript-eslint/no-floating-promises` catches most forgotten awaits, including a test file's
  own async helper (`renderTasks();` without `await`, verified 2026-10-03), which `check-test-code.mjs`
  does not follow; the checker catches the RNTL-specific ones. It counts as awaited: `await` (or `return`) before the whole chain
  (`expect(await within(row).findByText('Buy milk'))`), an element of an awaited
  `Promise.all([user.press(a), user.press(b)])` (or of `await Promise.all(names.map((name) => ...))`),
  an arrow function's expression body (`const showTasks = () => renderWithProviders(<TasksScreen />)`,
  then `await showTasks()`; never a `forEach` callback, whose promises are dropped), and
  `await expect(screen.findByText('Saved')).resolves.toBeOnTheScreen()`. A bare
  `expect(screen.findByText('Saved')).toBeTruthy()` asserts on the pending promise and always
  passes; the checker fails it. `rerender` and `unmount` count as RNTL calls only on what a render
  call returned (`view.unmount()`, `screen.rerender(...)`, or a destructured `{ rerender, unmount }`):
  `sub.unmount()` on a subscription is not flagged.
- `test-renderer` replaced React Test Renderer (types are `TestInstance`); no test imports either.
- The package ships its own agent guide,
  `node_modules/@testing-library/react-native/docs/guides/llm-guidelines.md`; this page agrees with it
  for 14.0.1. After an RNTL upgrade, read the new copy and update this page.

## The render helper and test/test-app.tsx

Two files, both copied from `templates/test/`:

- `test/render-with-providers.tsx` is the machinery and stays as shipped:
  `renderWithProviders(ui, options)`, `renderHookWithProviders(hook, options)` and
  `createProvidersWrapper(options)` (for a call that takes `{ wrapper }`). Each call asks
  `createTestApp(options)` for a fresh provider tree, renders inside it, and returns RNTL's result plus
  what the tree holds.
- `test/test-app.tsx` is the app's own wiring: the providers of the root layout, in the same order,
  built from test inputs. It starts with three: `ServicesProvider` over
  `createTestServices(options.services)` (the composition root's test twin, from
  architecture-and-boundaries; this skill ships synced copies under `templates/src/`), react-intl
  with an `onError` that throws, and a fresh TanStack Query cache with no retries and no
  garbage-collection timer. It grows with the app.

What the grown wiring builds for each render (see `examples/test-app.tsx`):

1. **Services**: `createTestServices({ clock: TEST_CLOCK, errorLog: THROWING_ERROR_LOG,
   ...options.services })` (architecture-and-boundaries) inside `ServicesProvider`. Any port the test
   did not pass throws on first use and names itself (`services.reminders.schedule was used, but the
   test gave no reminders port`). The default error log throws what it is given, so an error the app
   swallows into its log fails the test with the error itself.
2. **Stores**: the real store factories (state-management-zustand's `createStores`) over fake
   repositories that `options.seed` filled through their own methods before anything renders, behind
   the app's stores provider. Never a module-level store: it would
   outlive the test and leak state into the next one.
3. **Catalogs and language**: the app's real catalogs (i18n-strings-and-catalogs) with an `onError`
   that throws, so a missing message or a broken ICU string fails the test with react-intl's own error;
   the text locale and the layout direction follow the `language` and `direction` options (the
   canonical template wires both from the start).
4. **Theme, safe-area metrics, query cache** and anything else the root layout provides.

| Option (Tasks example) | Default | Effect |
|---|---|---|
| `language` | `'en'` | the catalog, the locale tag (the language's digits) and the text locale (`'ar'` renders Arabic, right to left) |
| `direction` | the language's own | the layout direction `useDirection()` reads (rtl-and-direction); `'ltr'` with `'ar'` is the run before the restart |
| `services` | none | the fakes; every other port throws on first use |
| `seed` | empty data layer | rows written through the fake repository before the stores read it |
| `theme` | `'light'` | the theme preference |

The result carries `stores`, `services`, the fake repository (`tasks`) and `queryClient` next to
RNTL's fields, so a test can call a store action, plan a failed write, read a fake's call log or seed
the query cache. Every render gets fresh ones.
`templates/test/render-with-providers.test.tsx` is the helper's own test and the model of every pattern
below; it also proves that a missing message throws.

When the app gains a provider (a new store, a new port), add it to `test/test-app.tsx` in the same
commit; a component that reads it then fails loudly in tests until the wiring has it.

## Queries: which one to use

Query through `screen`, not through values destructured from the render result.

1. `getByRole(role, { name })` first: it is what VoiceOver and TalkBack announce. A plain `View` with
   a role needs `accessible` to be found; `Pressable` is accessible by default.
2. `getByLabelText`, `getByPlaceholderText`, `getByText`, `getByDisplayValue` next.
3. `getByTestId` last, for elements without a role or text (a canvas host, a decorative card). The
   testIDs are the same `<screen>.<element>` names the end-to-end flows use (e2e-maestro).

- `findBy*` for anything that appears after a promise settles (a port load, a query, a state change).
  It is the async `getBy*`; await it. TanStack Query tells its observers on a timer, so data set with
  `queryClient.setQueryData` appears a tick later: `findBy*`, not `getBy*`.
- `queryBy*` only to prove absence: `expect(screen.queryByRole('button')).not.toBeOnTheScreen()`.
  Never `getBy*` for absence (it throws before the assertion), and never `queryBy*` with
  `toBeOnTheScreen()` for presence (use `getBy*`).
- No `container.queryAll()` walks; `screen.container` only for whole-tree helpers.

## Matchers

Prefer semantic matchers over props:

| Matcher | Checks |
|---|---|
| `toBeOnTheScreen()` | the element is in the tree |
| `toBeVisible()` | visible (style, `aria-hidden`, `accessibilityElementsHidden`, ancestors) |
| `toBeEnabled()` / `toBeDisabled()` | `aria-disabled` / `accessibilityState.disabled`, ancestors included |
| `toBeBusy()`, `toBeChecked()`, `toBeSelected()`, `toBeExpanded()` | the matching `aria-*` / `accessibilityState` field |
| `toHaveTextContent(text)` | text content (string or RegExp) |
| `toHaveAccessibleName(name)` | `aria-label`, `accessibilityLabel` or text content |
| `toHaveAccessibilityValue(value)` | `aria-value*` / `accessibilityValue` (sliders, progress) |
| `toHaveDisplayValue(value)` | a `TextInput`'s value |

`getBy*` already throws when nothing matches, so no extra null checks.

## Pressing, typing and waiting

```tsx
const user = userEvent.setup();
await user.press(screen.getByRole('button', { name: 'Add task' }));
await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Buy milk');
```

- `userEvent.setup()` once per test, then `user.press`, `user.longPress(el, { duration })`,
  `user.type`, `user.clear`, `user.paste`, `user.scrollTo(el, { y })`. It fires the full sequence
  (pressIn, pressOut, press) a finger does.
- `fireEvent` only when user-event has no equivalent (a custom event name); await it too.
- `waitFor` only when there is no element to find: one assertion per callback, never an empty
  callback, never a press or other side effect inside it (act first, then wait). Prefer `findBy*`.
- Never wait with `setTimeout` or a sleep. For promises that settle outside React (a service over a
  fake port) use `await flushMicrotasks()` from `@test/flush-microtasks`.
- `jest.useFakeTimers()` only for UI timers inside components (a toast that hides after 2 s); never
  for logic or the clock, which take an injected `ClockPort` or a timestamp.

## Accessible names built by the catalog (bidi isolates)

If the app's `t()` wraps interpolated names in FSI/PDI isolate characters (rtl-and-direction), the
accessible name of a button built with `t('premium.buy', { priceText: '€4.99' })` is `Buy – ⁨€4.99⁩`.
Build expected names with the app's own `isolate()` helper rather than typing the characters:

```tsx
const BUY_NAME = `Buy – ${isolate('€4.99')}`;
expect(await screen.findByRole('button', { name: BUY_NAME })).toBeEnabled();
```

Component tests assert the default-locale strings; translations are checked by the catalog tooling
(i18n-strings-and-catalogs), not by component tests. One RTL render (`{ language: 'ar' }`) per screen
proves the screen reads direction from context, not that it mirrors (Jest has no layout engine).

## Hooks

```tsx
const { result, stores } = await renderHookWithProviders(() => useTasksModel(), { seed });
// or, when the test needs the wrapper itself:
const { wrapper, stores } = createProvidersWrapper({ seed });
const { result } = await renderHook(() => useTasksModel(), { wrapper });
```

A hook that reads a store, a port, the theme or the catalog needs the providers;
`examples/use-tasks-model.test.tsx` is the pattern. `rerender(props)` and `unmount()` are async.

## Stores and services in tests

Seed state through the helper's options and change it through the actions of the returned `stores`
(in the Tasks example, `seed` rows are written to the fake repository the real store factories read):

```tsx
const { stores } = await renderWithProviders(<TasksScreen />, {
  seed: { lists: [{ name: 'Groceries' }] },
});
await act(() => {
  stores.tasks.getState().addTask(1, 'Buy milk');
});
expect(screen.queryByText('No tasks yet')).not.toBeOnTheScreen();
```

Never `jest.mock` a store module and never build a module-level store. Pass fakes for the ports a
component uses (`services: { purchase: createFakePurchase(script) }`) and assert on their call log. A
render-count check (React's `Profiler` with `onRender`) proves a component does not re-render on an
unrelated store change.

## Routes and navigation (Expo Router)

Route files in `src/app/` are thin: they render a screen from `src/features/`, whose view and model
hook carry the tests above. A route test adds what only the router knows: a press opens the right
URL, a deep link lands on the right screen with its params, a protected group redirects, the back
button returns. Write it with `renderRouterWithProviders` from `@test/render-router-with-providers`
(template `test/render-router-with-providers.tsx`, with its own test):

```tsx
import TasksRoute from '@/app/index';
import TaskDetailRoute from '@/app/tasks/[id]';
import { renderRouterWithProviders } from '@test/render-router-with-providers';

const ROUTES = { index: TasksRoute, 'tasks/[id]': TaskDetailRoute };

it('opens a task from the list', async () => {
  const user = userEvent.setup();
  const view = await renderRouterWithProviders(ROUTES, { seed: SEED }); // Groceries (1), Buy milk (2)

  await user.press(screen.getByRole('link', { name: 'Buy milk' }));

  expect(await screen.findByRole('header', { name: 'Buy milk' })).toBeOnTheScreen();
  expect(view.getPathname()).toBe('/tasks/2');
});
```

- **Routes** are an object of `'path/without/extension': Component`: the route files' default
  exports, a `_layout` such as `() => <Stack />` when the test needs a stack (back navigation), or
  small stand-ins. `initialUrl` opens a deep link (default `'/'`).
- The helper takes the same options as `renderWithProviders` (seed, services, language, direction) and returns the
  same state plus `getPathname()`, `getSegments()` and `getSearchParams()`. Await it.
- Navigate from outside React inside `act()`: `await act(() => { router.push('/tasks/new'); })`.
  Await every press too (`await user.press(...)`), or `getPathname()` still shows the old route.
  Read a param as `view.getSearchParams()['selected']` (the strict set has
  `noPropertyAccessFromIndexSignature`).
- **Stand-in hrefs under typed routes.** With typed routes generated (`npx expo customize
  tsconfig.json`, which CI runs before `tsc`), a literal href the app does not have fails `tsc`
  (`<Link href="/tasks/7">`, `router.replace('/sign-in')`). Name each stand-in href once as a const
  (`const TASK_7 = '/tasks/7' as Href;`, with a comment saying why); the helper's own test does this.
  Real route files keep real, typed hrefs.
- **Providers the tree lacks: pass a `_layout` stand-in.** `test/test-app.tsx` is the app's own
  provider tree; once the app has its `I18nProvider` (i18n-strings-and-catalogs), put it there.
  Until then (and in a library harness whose canonical tree stays bare), a route whose model calls
  `useT()` gets a `_layout` stand-in that renders `<I18nProvider ...><Slot /></I18nProvider>`. Safe
  areas the same way: `_layout: () => <SafeAreaProvider initialMetrics={{ frame, insets }}><Slot
  /></SafeAreaProvider>` (verified by adaptive-layout's route tests).
- **`EXPO_PUBLIC_*` values in a test** are set with `Object.assign(process.env, { EXPO_PUBLIC_API_URL:
  '...' })` and restored in `afterEach`; `jest.replaceProperty(process, 'env', ...)` had no effect
  on the app code's reads (observed by auth-and-secure-storage with jest-expo 57; not traced further).
- Route tests sit next to the feature (`src/features/tasks/tasks-navigation.test.tsx`), never in
  `src/app/`. Expo Router bundles every `.js`/`.ts(x)` file in the routes folder as a route (with
  expo-router 57.0.24, `EXPO_ROUTER_CTX_IGNORE` in `expo-router/_ctx-shared.js` keeps out only
  `+html`, `+native-intent` and `+api` files), so a test there ships in the bundle and `npx expo
  export` fails to resolve it, while the unit project still runs it (verified 2026-10-03).
  `check-test-setup.mjs` fails it (`test-in-routes`), a helper under `src/app/__tests__/` too. The
  route file needs no test beside it: the route test that renders its default export covers it, or
  it carries `// device-only: covered by <flow>`.
- **Why not `renderRouter` directly.** Verified on 2026-10-03 with expo-router 57.0.24 and RNTL
  14.0.1: `renderRouter` (expo-router/testing-library) returns RNTL's render promise with the route
  getters (`getPathname()`, `getSegments()`, ...) attached to the promise itself, so `await
  renderRouter(...)` does wait for the render but hands back RNTL's result, which has none of them.
  Expo Router's matchers (`toHavePathname`, `toHaveSegments`, `toHaveSearchParams`,
  `toHaveRouterState`) and `testRouter` throw `screen.getPathname is not a function`, and
  `renderRouter` switches on Jest's fake timers, which then stay on for the rest of the file (a later
  `flushMicrotasks()` hangs). Expo's SDK 57 testing guide shows `await renderRouter(...)` followed by
  `expect(screen).toHavePathname('/...')`; with these versions that line throws, so do not "fix" a
  route test back to the documented form. The helper keeps the promise, awaits the first commit,
  reads the route through its getters and restores real timers; `check-test-code.mjs` fails direct
  use in any form (named, namespace or default import, `require()`; `expo-router-testing`). After an
  expo-router or RNTL upgrade, retry the matchers in the helper's own test; when they work, the
  helper may forward them.

## Gestures, Skia and direction

- **Gestures** (React Native Gesture Handler 2.32): give the gesture `.withTestId('pan')`, import
  `fireGestureHandler` and `getByGestureTestId` from `react-native-gesture-handler/jest-utils`, then
  `await act(() => { fireGestureHandler(getByGestureTestId('pan'), [...]); })` (verified). The event
  list is `{ state: State.BEGAN }`, `{ state: State.ACTIVE, x, y }`, `{ state: State.END }`.
  Canvas gestures and hit-testing belong to canvas-gestures-and-hit-testing.
- **Components that draw with Skia**: render them like any other component. The central mock in
  `jest.setup.ts` turns every Skia element into an inert host element (`SkiaCanvas`, `SkiaPath`, ...)
  that keeps `testID` and accessibility props, so query by role and name (decorative art hidden from
  screen readers: add `{ includeHiddenElements: true }` to find it by `testID`). Write no per-file Skia
  mock unless the test inspects Skia calls; pixels are proven in the golden project.
- **No layout engine in Jest.** Jest has no Yoga, and the React Native preset mocks
  `I18nManager.isRTL = false`. Test direction logic as pure functions and logical style keys under an
  explicit locale; judge mirroring only on device screenshots (e2e-maestro, design-review-workflow).

## Android behaviour

Behaviour that differs on Android is tested in `<unit>.android.test.ts(x)`, which only the `android`
project runs (preset `jest-expo/android`). There `.android.tsx` files resolve, `Platform.OS` is
`'android'`, `Platform.select` picks the `android` branch, and `BackHandler` is the real Android
module. Verified with React Native 0.86.3: inside `act()`, `DeviceEventEmitter.emit('hardwareBackPress')`
reaches the `BackHandler` listeners, while the same test under `jest-expo/ios` does nothing (iOS has no
hardware back button). With the router (verified 2026-10-03, expo-router 57.0.24, android project),
the same event pops an Expo Router stack (`_layout: () => <Stack />`), and a screen's own
`BackHandler` listener that returns `true` runs instead of the pop:

```tsx
await renderWithProviders(<TaskEditorScreen initialTitle="Buy milk" />);
await act(() => {
  DeviceEventEmitter.emit('hardwareBackPress');
});
expect(screen.getByRole('alert', { name: 'Discard this task?' })).toBeOnTheScreen();
```

`examples/task-editor.android.test.tsx` is the pattern. Never overwrite `Platform.OS`, mock the
`Platform` module or `jest.replaceProperty(Platform, 'OS', ...)` in an iOS-project test: the value
leaks into later tests (restoreMocks does not restore an assignment), `.android.tsx` files still
resolve to the iOS ones, and `check-test-code.mjs` fails it (`platform-override`). Things Jest cannot
show on either platform (edge-to-edge insets, predictive back animations, TalkBack focus order,
permission dialogs) are proven on the emulator by end-to-end flows.

## Style assertions: only where the style is the contract

Assert visible text, roles and accessible names, never class names. A style is asserted only when
the style itself is what the spec promises:

- design-system components in `src/ui/` and `src/theme/` (sizes, radii and type roles from the tokens,
  the 44 × 44 pt minimum touch target);
- the text contract in `src/i18n/` (writing direction and start alignment of the localized text
  component).

`check-test-code.mjs` accepts `toHaveStyle(` in those folders (contract `styleContractGlobs`).
Anywhere else, looks are proven by device screenshots; where a style really is the contract (a
progress fill that must not mirror in RTL, a slider's fill width), put
`// allow-style-assertion: <why>` on the line above, or once in the file header. The reason needs at
least 10 characters. No component snapshots (`component-snapshot`): readable data snapshots live in
`*.golden.test.ts` (golden-and-snapshot-tests).

## Tests that render without the providers (the no-providers marker)

Three kinds of test render with plain `await render(...)` / `await renderHook(...)` on purpose, and
each says why with one comment in the file (the reason at least 10 characters):

- **The unit reads nothing from context:** a props-only component (an error boundary, a row whose
  data is passed in) or a hook whose dependencies are all injected.
- **The test supplies the provider under test itself:** a test of `I18nProvider`, `ThemeProvider` or
  `MotionConfig` renders that provider around a probe; the render helper would wrap it a second time.
- **The test proves the no-provider default:** a hook that falls back to the phone's setting (or a
  context's default value) outside its provider is tested exactly there; the helper would hide it.

```tsx
// no-providers: TaskRow is a pure view of its props and reads no store, service or catalog.
// no-providers: this file tests I18nProvider itself, so it renders <I18nProvider><T /></I18nProvider>.
// no-providers: proves useReduceMotion follows the phone's switch when no MotionConfig is above it.
```

A test that builds its own provider can pass `{ wrapper }` instead of adding the comment. A test that
proves a hook or component fails outside its provider renders without the providers on purpose and
needs no comment, as long as it asserts the rejection:

```tsx
await expect(renderHook(() => useServices())).rejects.toThrow(
  'useServices() needs a <ServicesProvider> above it',
);
```

If the unit later starts reading a store, a port or the catalog, the plain render fails loudly (no
provider); switch to the render helper then.

## What not to test

- Component trees as snapshots, style objects, class names, private helpers or hook internals.
- Third-party internals: Expo Router transitions, Skia's rasteriser, Reanimated's animation engine,
  StoreKit or Play Billing dialogs, a consent form's content. Test your use of them (adapter mapping,
  your state, your draw calls).
- Translation wording in component tests.
- Layout and mirroring (no Yoga): device screenshots do it.
- Timing with real clocks, sleeps or `setTimeout` waits; the network; the machine's locale or time zone.
- Trivial type-only modules, re-exports and constants tables (covered by the tests that use them).
- The same behaviour at two levels without a reason: a rule proven by properties needs no component test.

## Good and bad patterns side by side

```tsx
// Good
it('sends a press through the injected port', async () => {
  const user = userEvent.setup();
  const script = scriptWith(PRODUCT);
  await renderWithProviders(<PremiumOffer />, { services: { purchase: createFakePurchase(script) } });

  await user.press(await screen.findByRole('button', { name: BUY_NAME }));

  expect(script.calls).toStrictEqual(['fetchProduct', 'requestPurchase']);
});

// Bad, and what check-test-code.mjs reports
it('buys', () => {
  render(<PremiumOffer />);                                  // rntl-await, render-with-providers
  const { getByText } = render(<PremiumOffer />);            // destructured-queries
  fireEvent.press(getByText('Buy'));                         // rntl-await
  expect(screen.queryByText('Premium')).toBeOnTheScreen();   // query-for-presence
  expect(screen.getByText('Error')).not.toBeOnTheScreen();   // get-for-absence
  Platform.OS = 'android';                                   // platform-override
  expect(screen.toJSON()).toMatchSnapshot();                 // component-snapshot
});
```

## Appendix: when the app uses React Navigation 7 (static API)

Not verified in the reference app (React Navigation is not installed there); the shape follows React
Navigation's own testing guide. Render the real navigator, never a mock of `@react-navigation/native`,
inside the same providers:

```tsx
const Navigation = createStaticNavigation(RootStack);
await renderWithProviders(<Navigation />, { seed });
await user.press(screen.getByRole('button', { name: 'Open task' }));
expect(await screen.findByText('Buy milk')).toBeVisible();
```

Assert the screen that appears, not that `navigate` was called. React Navigation's guide advances
transition animations with `jest.useFakeTimers()` and `await act(() => jest.runAllTimers())`: a UI timer,
so it is allowed in a feature test and never in the logic folders. A model hook that calls
`useNavigation()` is rendered inside a one-screen static navigator rather than with a mocked hook.
`transformIgnorePatterns` already lets `@react-navigation` through Babel (`templates/jest.config.js`).
