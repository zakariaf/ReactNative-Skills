# Appendix: React Navigation 7 (static API)

For an app that does not use Expo Router (an older app, or a team that wants navigation declared in
one object instead of files). The rules of SKILL.md hold the same way; only the mechanics differ. Set
`"router": "react-navigation"` in the contract and check-navigation applies this appendix's rules.

## Contents

- Mapping from Expo Router
- The files
- The static config and its groups
- Typed routes and params
- The container
- Back: usePreventRemove and popTo
- Testing a real static stack
- Verified facts and versions

## Mapping from Expo Router

| Expo Router | React Navigation 7 static |
|---|---|
| a route file under `src/app/` | a screen entry in `createNativeStackNavigator({ screens })` |
| `Stack.Protected guard={isSignedIn}` | a group `{ if: useIsSignedIn, screens }` (the hook reads a store selector) |
| `experiments.typedRoutes` + generated types | `interface RootParamList extends StaticParamList<typeof rootStack>` in a `.d.ts` |
| `useLocalSearchParams()` + a valibot parser | params typed by the screen's `StaticScreenProps<Params>`; still parse anything a deep link can carry |
| `router.dismissTo('/')` | `navigation.popTo('Home')` (or `StackActions.popTo`) |
| `router.back()` | `navigation.goBack()` |
| `usePreventRemove` from `expo-router/react-navigation` (SDK 57) | `usePreventRemove` from `@react-navigation/native` |
| `<Stack screenOptions={{ animation: useScreenAnimation() }}>` | `rootStack.with(({ Navigator }) => <Navigator screenOptions={{ animation: useScreenAnimation() }} />)` |
| `+not-found.tsx` | a `NotFound` screen and `linking.config.screens.NotFound: '*'` when the app has links |
| the navigation theme through `NavigationThemeProvider` | `<Navigation theme={toNavigationTheme(theme)} />` |

## The files

The shapes are in `examples/react-navigation/` (the self-test runs the checker on them). Their homes:

| File | Job |
|---|---|
| `src/features/root-navigator/root-stack.tsx` | the one static config: groups, screens, options |
| `src/features/root-navigator/route-guards.ts` | the groups' `if` hooks (react-components-and-hooks accepts hooks in `*-guards.ts`) |
| `src/features/root-navigator/route-params.ts` | the params types (plain data) |
| `src/features/root-navigator/react-navigation.d.ts` | the global `RootParamList` |
| `src/features/root-navigator/navigation-root.tsx` | the only container: `.with()` for motion, the theme |
| `src/features/root-navigator/debug-route.tsx` | the Debug group's screen, through `TEST_ONLY` |
| `src/features/task-editor/use-task-editor-model.ts` | a guarded screen's model: `usePreventRemove`, the leaving ref, `popTo` |

The root is `App.tsx` (or `index.ts` registering it): the same startup order as the Expo Router root
(error net, services, `DirectionGate`, providers, `SafeAreaProvider`, `GestureHandlerRootView`,
`MotionConfig`), ending in `<NavigationRoot />`. Without Expo Router nothing mounts
`SafeAreaProvider` for you: mount it once at the root (react-components-and-hooks).

## The static config and its groups

- `createNativeStackNavigator({ screenOptions, groups, screens })` from `@react-navigation/native-stack`:
  the native stack. `@react-navigation/stack` (the JavaScript stack) only with `"jsStack": true`.
- Nested navigators (tabs inside the stack) are declared inside the same static tree (a screen whose
  `screen` is another static navigator), never as a second container (`one-navigator`).
- Flows are groups: `{ Onboarding: { if: useIsOnboarding, screens }, Main: { if: useIsOnboarded,
  screens } }`. A group whose hook returns false is not registered at all; the navigator re-renders
  when the store changes and lands on the first screen of the first group that renders. Finishing
  onboarding is a store dispatch, never `navigate()` or `reset()` (`flow-by-guard`).
- Group order decides the first screen: `home` must be the first screen of its group (`home-route`).
- Name the exported config `rootStack` (camelCase): it is a value, not a component.
- A screen entry is the component (`Home: HomeScreen`) or `{ screen, options, if }`; the component is a
  small route-like wrapper in `src/features/<feature>/` that calls the model hook and renders the
  pure view.

## Typed routes and params

- `react-navigation.d.ts`: `declare global { namespace ReactNavigation { interface RootParamList
  extends StaticParamList<typeof rootStack> {} } }`. `useNavigation()` then needs no generic, and
  `navigate('Nope')` or a wrong param fails `tsc`. `interface` is required for declaration merging;
  the lint config allows it only in `*.d.ts`.
- A screen declares its params by its props: `type TaskDetailProps = StaticScreenProps<TaskDetailParams>`.
- Params are small and serialisable: ids and plain values (`params-serialisable`). Functions break
  state restore and make React Navigation warn ("Non-serializable values were found in the
  navigation state"); objects that live in a store go stale.
- A test stack's container ref is typed `createNavigationContainerRef<ParamListBase>()`: the global
  `RootParamList` does not fit a test stack under `exactOptionalPropertyTypes`.

## The container

- `const Navigation = createStaticNavigation(motionAwareStack)` once, rendered from the root.
- `.with()` wraps the static navigator in a component so its `screenOptions` can call hooks; they merge
  over the static ones. Name the wrapper function (`function MotionAwareStack`) for the display-name
  and naming rules (`motion-transition`).
- `direction`: pass nothing (it defaults to `I18nManager`, the layout's own source) or
  `readLayoutDirection()`; never a direction derived from the language setting (rtl-and-direction's
  `layout-direction`).
- `theme={toNavigationTheme(theme)}` from the app theme, so the screen container never flashes white
  in dark mode (design-system-structure).
- `initialState`: leave it out normally. With `exactOptionalPropertyTypes`, omit the prop instead of
  passing `undefined` (`{...(state === undefined ? {} : { initialState: state })}`).
- `linking`: only when the app handles links (deep-links-and-universal-links), and every param read
  from a link is parsed like an Expo Router param.

## Back: usePreventRemove and popTo

- In React Navigation 7 `navigate(name)` pushes (the StackRouter's `NAVIGATE` pushes unless `pop:
  true`), so `navigate('Home')` stacks a second Home (`go-back`).
- `popTo(name)` goes back to the nearest route with that name; when there is none it replaces the
  current route with it. `goBack()` pops one.
- The editor's model (`examples/react-navigation/use-task-editor-model.ts`) blocks removal with
  `usePreventRemove(hasUnsavedChanges, ({ data }) => ...)`: the callback holds `data.action` while the
  discard dialog is open and dispatches it on Discard; a save sets the leaving ref first, then
  `popTo`, and the callback lets that one action through. The native stack refuses the iOS swipe
  natively while prevention is on.
- `gestureEnabled: false` with `fullScreenGestureEnabled: false` only on screens where even starting the
  swipe harms (`"gesture": "off"`).

## Testing a real static stack

- jest-expo's preset mocks react-native-screens, so a real static native stack renders in Jest
  (`await render(<Navigation ref={ref} />)`).
- Drive Back with the ref: `await act(() => { ref.goBack(); })`; read `ref.getCurrentRoute()?.name`.
- Fake what the test is not about with `jest.mock` factories; inside a factory, `require()` what it
  needs and name shared objects `mock…`.
- Assert the reduce-motion fade through react-native-screens' `RNSScreen` host element's
  `stackAnimation` prop (`'fade'` while motion is reduced).
- Run with the paths first: `npx jest src/features/root-navigator --selectProjects unit`.

## Verified facts and versions

`@react-navigation/native` 7.5.0, `@react-navigation/native-stack` 7.20.0, `@react-navigation/core`
7.23.0 are the current 7.x releases (`npm view @react-navigation/native version`, 2026-10-10; 8.0 is
in alpha). They are not installed in this library's reference app (Expo Router carries its own copy),
so the examples here are shapes checked by check-navigation, not compiled. The patterns (groups with
`if` hooks, `.with()`, `popTo`, the prevent-remove flow, the real-stack tests) were verified with
`@react-navigation/native` 7.4.1 and native-stack 7.19.2 on Expo SDK 57 in the source app this skill
came from (2026-09-28). Re-verify: install the two packages in a scratch Expo app, copy the examples,
run `tsc`.
