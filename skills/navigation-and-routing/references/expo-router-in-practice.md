# Expo Router in practice

How an Expo app's routes, layouts, flows, params, modals and back handling are built, and the facts
behind each rule. The rules themselves are in SKILL.md; the contract and the checker are in
`contract-and-checker.md`; React Navigation's static API is in `react-navigation-static.md`.

## Contents

- File routes: what is a route, what is bundled
- The root layout and the startup order
- Layouts: one navigator tree
- Typed routes and hrefs
- Params: parse them at the edge
- Flows: Stack.Protected, never a redirect
- Modals and what is not a route
- Back handling (iOS and Android)
- Going back to a screen already in the stack
- Not found
- Debug routes and placeholders
- Where navigation code lives
- Testing navigation
- Verified facts and versions
- Pitfalls seen before

## File routes: what is a route, what is bundled

Every file under `src/app/` is a route, named by its path: the **route id** is the path without the
extension (`(app)/tasks/[taskId]`), and its **href** drops the groups and a trailing `index`
(`/tasks/[taskId]`, `(app)/index` is `/`).

| File | What it is |
|---|---|
| `_layout.tsx` | the layout of its folder: renders the navigator (Stack, Tabs, Slot) its routes appear in |
| `(name)/` | a group: organises files and shares a layout without adding a URL segment |
| `[taskId].tsx`, `[...rest].tsx` | a dynamic route: the segment arrives as a param (any text, from anywhere) |
| `+not-found.tsx` | the route for any URL that matches nothing |
| `+html.tsx`, `+native-intent.tsx`, `+middleware.ts`, `*+api.ts` | web shell, incoming-link rewriting, server middleware and API routes: not screens (check-navigation leaves them out of the route table) |
| `name.ios.tsx`, `name.android.tsx` | platform variants of one route (one route id) |

Expo Router bundles every file in that folder except `+api`, `+html` and `+middleware`, so a test, hook
or helper placed there ships as a route (architecture-and-boundaries' `route-file`). Route files stay
thin: a default export that renders a screen from `src/features/<feature>/` with its model hook
(architecture-and-boundaries' `route-thin`; naming-conventions names it `<Name>Route`).

The contract (`contracts/navigation.json`) lists every route id. Adding a screen is: add the id to the
contract, create the route file, add its `Stack.Screen` when it needs options, run the checker.

## The root layout and the startup order

The root skeleton (`src/app/_layout.tsx`, `src/features/root-navigator/{app-root,root-stack,app-stack}.tsx`)
and the startup order belong to app-startup-and-bootstrap, which ships those files; copy them from
there and do not rewrite them here. This skill owns what goes inside `AppStack` (the root
`Stack.Protected` groups) and every route below it. The tree, for orientation (each piece belongs to
the skill named in brackets):

```
index.ts                              Intl polyfills first, then 'expo-router/entry' (i18n-strings-and-catalogs)
src/app/_layout.tsx  RootLayout       the error net import, then the splash hold (error handling, app-startup)
                                      export const ErrorBoundary = createRouteErrorBoundary(...) (error-handling-typed-results)
                                      first render: createDeviceServices() (adapters, no I/O) and the language,
                                      in a state initializer (architecture-and-boundaries, i18n)
  DirectionGate                       restarts once into the language's layout direction, or renders (rtl-and-direction)
    AppRoot                           startApp(): database open, error-net sink, stores, the optional root kits
                                      (createRootKits), the startup gate; watchSystemA11y(); the splash release
                                      (app-startup-and-bootstrap)
      ServicesProvider > AppDataProvider > I18nProvider > AppThemeProvider > TextLocaleProvider
        RootStack                     GestureHandlerRootView > MotionConfig > NavigationThemeProvider
                                      (keyboard, session, feedback and ads providers slot in here)
          AppStack                    RootKits (the kits' providers and effects: notification tap routers,
                                      consent appliers, screen views) around <Stack screenOptions={{ animation }}>
                                      with the root Stack.Protected groups (this skill)
src/app/(app)/_layout.tsx             the app's Stack: titles (useT works here), per-screen options (this skill)
```

Why this shape matters for routes:

- **The navigator is two files below the layout.** React context flows down only: `useScreenAnimation()`
  must run below `<MotionConfig>`, and `useT()` below `I18nProvider`, so the Stack that reads them is
  its own component (and, under `react/no-multi-comp`, its own file). The checker follows the root
  layout's rendered components through their imports to find the navigator (`root-layout`).
- **Nothing navigates during startup.** Flows are guards (below); the first screen is whatever the
  guards and the route table make reachable. A startup that "decides where to go" with
  `router.replace` in an effect shows the wrong screen for a frame and can run before the navigator
  is mounted ("Attempted to navigate before mounting the Root Layout component"). The splash hides
  without navigating (app-startup-and-bootstrap releases it from AppRoot).
- **Reopening work after a kill.** Expo Router takes no `initialState`, and navigation state is never
  persisted. The default: the home screen's model reads the saved draft (app-startup-and-bootstrap's
  flushed draft buffer) and offers a "Continue editing" action, which pushes the editor like any other
  tap, so the history is the ordinary one (home, then editor) and Back works. This is not "navigating
  during startup": it happens after the first screen is shown, on the person's tap. An app that must
  reopen the editor by itself does it once from the home model after its first screen mounted, guarded
  by a ref so a re-render cannot push twice, with a test that renders home with a saved draft and
  expects one push.

## Layouts: one navigator tree

- **One tree, built by Expo Router.** Never render `NavigationContainer` or call
  `createStaticNavigation` in an Expo Router app: it builds a second, unlinked tree (no URLs, no
  typed routes, its own back stack). A custom navigator (material top tabs) goes through
  `withLayoutContext(Navigator)` so it becomes a layout.
- **No `@react-navigation/*` imports.** expo-router 57 carries its own copy of React Navigation
  (`node_modules/expo-router/build/react-navigation/`); the app's own `@react-navigation/native`
  would be a second copy with its own contexts, and hooks from it throw "Couldn't find a navigation
  object". Import hooks, `Stack`, themes and `useNavigation` from `expo-router`, and what it does not
  re-export (`usePreventRemove`, `StackActions`, `NavigationAction`) from `expo-router/react-navigation`.
- **The native stack.** `Stack` from `expo-router` is react-native-screens' native stack: UIKit and
  Android fragments draw the transitions, the swipe and the header. The JavaScript stack
  (`expo-router/js-stack`) is for a transition the platform cannot do; the contract then says
  `"jsStack": true` with the reason.
- **Animation.** Every `<Stack>` takes `screenOptions={{ animation: useScreenAnimation() }}`
  (motion-and-animation's rule and hook): a cross-fade while motion is reduced, because native stack
  transitions ignore Reanimated's reduce-motion setting.
- **One header strategy per stack.** Either the native header (titles in the layout's `Stack.Screen`
  options) or the app's own top bar with `headerShown: false`, set once in `screenOptions`, never a
  mix per screen. A screen under a native header uses react-components-and-hooks' `ScreenFrame` with
  `BELOW_HEADER_EDGES`, so the top inset is not added twice.
- **Tabs.** `Tabs` from `expo-router` (a JS tab bar) or `NativeTabs` (`expo-router/unstable-native-tabs`,
  the platform's tab bar). A tab layout sits in its own group (`(tabs)/_layout.tsx`) inside the root
  Stack, so pushing a detail screen covers the tab bar. Tabs take `animation: isReducedMotion ? 'none'
  : 'shift'` from `useReduceMotion()` (motion-and-animation). On a wide window the JS tab bar moves to
  the side (`tabBarPosition: isWide ? 'left' : 'bottom'`, from adaptive-layout's window class; which
  edge it lands on in a right-to-left layout is not verified here, so check it on a device); a side
  bar takes that edge's inset, so
  the screens beside it use a `ScreenFrame` edge set without that edge. Nothing navigates when the
  window crosses the breakpoint: the same routes render, only the bar moves.
- **Depth.** Keep the stack shallow enough that Back is predictable: a detail reached from a list,
  an editor reached from the detail. A flow that keeps pushing the same screens (`detail → detail →
  detail`) uses `router.replace` or `dismissTo` instead.

## Typed routes and hrefs

- `experiments: { typedRoutes: true }` in `app.config.ts` makes `<Link href>`, `router.push` and the
  hooks check hrefs against the route files: a renamed route fails `tsc` everywhere it is linked.
- The types are generated into `.expo/types/router.d.ts` (git-ignored) when `npx expo start` runs;
  CI and a fresh clone run `npx expo customize tsconfig.json` before `tsc`. Without the file, hrefs
  are plain strings and nothing is checked.
- Write hrefs as typed paths (`` `/tasks/${taskId}` ``) or objects
  (`{ pathname: '/tasks/[taskId]', params: { taskId } }`). `as Href` switches the check off for that
  link (`href-cast`). Relative hrefs (`./edit`) are not typed; build them from `useSegments()` if a
  shared component needs one.
- Route tests mount stand-in route trees (`renderRouterWithProviders(ROUTES)`) whose paths are not
  the app's, so with generated types `router.push('/tasks/7')` fails `tsc` in the test (verified on
  2026-10-10 after `npx expo customize tsconfig.json`). The templates name each stand-in href once,
  `const TASK_7 = '/tasks/7' as Href;`, with a comment saying why; `href-cast` allows that in tests
  and nowhere else.

## Params: parse them at the edge

Every route is a URL. A deep link, a notification tap, a shared link or a typo can open
`/tasks/<anything>`, a repeated query key arrives as an array, and the type argument of
`useLocalSearchParams<{ taskId: string }>()` is a cast, not a check (`params-parsed` flags it in app
code). So:

- The model hook reads `useLocalSearchParams()` without a type argument and passes the raw params to
  the route's parser (`templates/src/features/task-detail/task-detail-params.ts`): a valibot schema,
  a `Result` back (error-handling-typed-results), and the screen's "not found" state on failure. The
  contract maps each dynamic route to its parser file (`paramParsers`).
- `useLocalSearchParams` (the params of this screen) in screens; `useGlobalSearchParams` re-renders on
  every URL change of the whole app and is for the rare component that must follow the top route.
- Params are ids and short plain values. Pass a task's id, never the task: the screen reads the task
  from its store or query, so a deep link and a restored screen work the same way.
- Ids are short slugs (`task-12`); reject anything else in the schema (a `../settings`, a 5 KB string).
- A parsed param is still the link's: a `v.url()` field passes any URL and a `returnTo` path names any
  screen. Never hand one to `Linking.openURL`/the browser (build outgoing URLs in a `src/config` helper
  from the parsed id) or to `router.replace` (a return after sign-in goes through
  deep-links-and-universal-links' pending-link inbox). Its `open-redirect` rule flags the first.

## Flows: Stack.Protected, never a redirect

A flow (signed out / signed in, onboarding / main, test builds only) is a `Stack.Protected` group
whose `guard` reads a store selector. Changing the flow is a store action; the router does the rest.
These facts are pinned by `templates/src/features/root-navigator/protected-routes.test.tsx`
(expo-router 57.0.24, run on 2026-10-10):

- With the guard false, the group's screens are unreachable: a deep link into it lands on the first
  screen that is reachable (the anchor or the first available screen).
- Flipping the store value moves the person by itself: no `navigate`, no `replace`.
- When the guard turns false while the person is inside the group, its screens leave the history
  (`router.canGoBack()` is false): Back cannot return to a signed-in screen after sign-out.
- A screen exists in one group only; nest groups for "signed in and admin".

Rules that follow (`protected-guard`, `flow-by-guard`):

- Every group is in the contract (`file`, `guard`, `screens`); the checker compares them with the code,
  because a screen written outside its group is reachable whatever the guard says.
- No `<Redirect>` in a layout and no navigation from a layout's effect to switch flows: the guarded
  screen renders first, and the redirect runs again on every render. `<Redirect>` stays fine in a
  plain route that only forwards (an old URL to its new home).
- Guards are client-side: they hide screens, they do not protect data. The server still checks every
  request (auth-and-secure-storage owns sessions and tokens).
- Group order matters only for the anchor: the first reachable screen opens.
- A guarded group needs its own `(group)/_layout.tsx`. Without one, the guard protects none of its
  screens and nothing warns (auth-and-secure-storage's `session-guards.test.tsx` pins it).
- A route the system opens during a flow change stays outside every guard (an `oauth-redirect` route
  for Android OAuth, auth-and-secure-storage), or the guard drops it before it can finish.
- **A deep link into a guarded group loses its destination on SDK 57**: the guard sends the person to
  the first reachable screen, and after sign-in nothing returns them. deep-links-and-universal-links
  owns the fix (its pending-link inbox): the link's `LINK_ROUTES` entry names a `gate` and `open()`,
  `+native-intent` records the link while that gate is closed, `useLinkGate(gate, isOpen)` sits where
  this guard is decided, and `useOpenPendingLink(gate)` in the signed-in home's model opens it once.
  The gate checks kinds; this skill's params parser is still the second check on the screen. SDK 58
  adds `redirectTo` on `Stack.Protected` (Expo's protected-routes page), which may replace it.
- **A biometric lock** (Face ID, Touch ID, Android BiometricPrompt) is a flow too, never a startup
  task: a `(locked)` group with the lock screen, guarded by `isLocked` from the session store, before
  the `(app)` group guarded by `!isLocked`. The lock screen asks on mount and on its button, a success
  flips the store, and the guards move the person; app-startup-and-bootstrap releases the splash
  before it, so the prompt never waits under the splash.

## Modals and what is not a route

- A **destination** is a route: something the person opens, can link to, and leaves with Back. A
  compose screen is a route with `presentation: 'modal'` in its `Stack.Screen` options; the contract
  lists it in `modals` and the checker holds both directions (`modal-presentation`).
- **iOS:** `modal` is a page sheet (swipe down dismisses it, and that swipe is a removal
  `usePreventRemove` can block); `formSheet` takes `sheetAllowedDetents`; `fullScreenModal` covers the
  screen and has no swipe. **Android:** `modal`, `fullScreenModal` and `pageSheet` open like a push;
  `formSheet` is a Material bottom sheet (react-native-screens 4.26 docs; Android sheets were not
  verified on a device here).
- **Not a route:** anything that must keep the screen underneath mounted and live: a confirmation, the
  discard dialog, a pause layer over an in-progress session, a toast. A route change would cover or
  unmount it. Render it inside the screen or in the app's dialog host (ui-states-and-feedback).
- Close a modal with `router.back()`; leave a modal flow for a screen below with
  `router.dismissTo(href)`.

## Back handling (iOS and Android)

What removes a screen: the header back button, the iOS edge swipe (and, from iOS 26, a swipe anywhere:
`fullScreenGestureEnabled` defaults to true there), a modal's swipe down, Android's back button and back
gesture (with predictive back, `android.predictiveBackGestureEnabled: true`, the system previews the
screen below while the finger moves), and `router.back()` / `dismissTo()` from code.

- **`usePreventRemove` sees all of them.** A `BackHandler` listener sees only Android's button and
  gesture, and misses the swipe, the header button and code. While prevention is on, the native stack
  passes `preventNativeDismiss` to react-native-screens (read in expo-router 57.0.24,
  `NativeStackView.native.js`), so the iOS swipe and the sheet swipe are refused natively and the
  callback runs instead.
- **The guard.** `templates/src/features/task-editor/use-discard-guard.ts` (a react-hook-form screen
  passes `useFormState({ control }).isDirty` as the "unsaved" boolean, forms-and-input): while
  `hasUnsavedChanges`, a removal is held; the screen shows its "Discard changes?" dialog; Keep editing
  closes it; Discard replays the held action; `leave(go)` lets a deliberate exit (after a save)
  through, because the "unsaved" state has not re-rendered yet when the screen navigates; `go` must
  remove this screen (back, `dismissTo`, `replace`), and the guard arms again by itself when the
  screen stays and has unsaved changes once more (a push on top, then Back). Its tests
  pin these paths on iOS and the Android back button (`use-discard-guard.android.test.tsx`, the
  `android` Jest project). The contract lists the route in `guarded` with the hook file that calls it
  (`guarded-prevent-remove`).
- **SDK 57 vs 58.** On SDK 57 `usePreventRemove` comes from `expo-router/react-navigation` and its
  callback receives `{ data: { action } }` to dispatch. From SDK 58 it is exported by `expo-router`, the
  callback gets `repeat()` (set the condition false first, then `repeat()`), the hook returns
  `disablePrevention`, and the `beforeRemove` event is gone (Expo's SDK 57 to 58 guide). Upgrade the
  template's two calls in the SDK upgrade (expo-sdk-upgrade).
- **Swipe off only where starting it is wrong.** With the guard, the swipe asks. Turn it off
  (`gestureEnabled: false` and `fullScreenGestureEnabled: false`, contract `"gesture": "off"`,
  `guarded-gesture-off`) only for a screen where a half-started swipe already harms: a live session,
  a canvas that reads horizontal pans (canvas-gestures-and-hit-testing). Android's back gesture is
  never turned off; it reaches the guard.
- **The guard cannot see the app being killed.** Save the draft as it changes (persistence-and-migrations);
  the guard only stops the person from throwing it away by accident.
- **Predictive back on Android** (Android 13+): Expo writes `android:enableOnBackInvokedCallback="false"`
  unless `android.predictiveBackGestureEnabled` is true (`@expo/config-plugins`, `PredictiveBackGesture.js`,
  read on 2026-10-10), so an Expo app opts out even on Android 16 with target API 36. Set it to true (the
  reference app does) to get the system preview. The prevented case was verified in Jest
  only (`jest-expo/android`, `hardwareBackPress`). Check the real gesture on an Android emulator with
  gesture navigation through e2e-maestro (a named AVD) before relying on its animation.

## Going back to a screen already in the stack

Pinned by `templates/src/features/not-found/not-found-navigation.test.tsx` (expo-router 57.0.24):

- `router.navigate(href)` and `router.push(href)` push: going "home" with them stacks a second home
  (`router.canGoBack()` stays true). `<Link href="/">` does the same.
- `router.dismissTo(href)` goes back to that screen when it is below, and replaces the current screen
  with it when it is not. `<Link dismissTo href="/">` is the link form.
- `router.back()` pops one screen; `router.dismiss(n)` pops within the current stack.

So the home route (the contract's `home`) is reached with `dismissTo` or `back`, never `navigate` or
`push` (`go-back`).

## Not found

- `src/app/+not-found.tsx` renders for a URL that matches no route (an old link, a typo, a removed
  screen). Without it the router shows its development "Unmatched route" page (`not-found`).
- The template's one action is `router.dismissTo('/')`: a cold-start deep link opens the not-found
  screen alone, and `dismissTo` replaces it with the first screen, so Back cannot return to the dead
  link.
- Never print the URL on the screen: it can hold anything.
- A valid route with an unknown id (`/tasks/task-999`) is not a not-found route: the task detail
  screen shows its own "task not found" state from its query or parser failure.

## Debug routes and placeholders

- **Debug routes** (`debugRoutes`): a test-build screen is a route (so e2e flows and debug deep links
  open it), rendered only through `TEST_ONLY?.DebugScreen` (debug-menu-and-test-hooks owns the gate:
  its literal variant check lets Metro drop the code from production bundles) and listed in a
  `Stack.Protected guard={isTestBuild}` group, so a production deep link cannot open an empty page
  (`debug-gated`). architecture-and-boundaries' `test-only-gate` checks the import side.
  debug-menu-and-test-hooks ships `src/app/(debug)/_layout.tsx` (a plain `<Slot />`) and the leaf
  routes `(debug)/debug/index` (`/debug`) and `(debug)/debug/setup` (`/debug/setup`), each of which
  renders its `TEST_ONLY` member or a `<Redirect href="/" />`. List both ids in `debugRoutes` and
  `routes`, and guard the group in `AppStack`:
  `<Stack.Protected guard={isTestBuild}><Stack.Screen name="(debug)" /></Stack.Protected>` with
  `const isTestBuild = TEST_ONLY !== null;`, recorded in `protected` as
  `{ "file": "src/features/root-navigator/app-stack.tsx", "guard": "isTestBuild", "screens": ["(debug)"] }`.
- **Placeholders** (`placeholders`): while an app is built screen by screen, a route whose screen is
  not ready renders a placeholder screen (`examples/placeholder-screen.tsx`), so the full route table,
  its typed hrefs and every model hook's navigation exist from the start; no no-op handlers. The
  contract lists them, and `check-navigation --release` fails while any is left
  (`placeholder-release`).

## Where navigation code lives

- Navigation calls live in a feature's model hook (`use-<feature>-model.ts`) as `onX` callbacks the
  pure view receives (react-components-and-hooks). `src/ui`, `src/stores`, `src/services`, `src/data`,
  `src/api` and `src/core` never import a router (`nav-in-screens`; a type-only `import type { Href }`
  is fine). The exception is a root kit's effects (`*-root-kit.tsx`): push and local notification taps
  are navigation from outside, routed beside the root Stack after the navigator mounted (startup step
  F6 of app-startup-and-bootstrap), never during startup.
- A store never navigates: it changes state, and a guard or the model hook reacts.
- Navigation state is never persisted: the stack is rebuilt from the routes at launch, and an open
  editor is reopened from its saved draft by its own model.
- Handlers are synchronous; async work starts with `task().catch(report)` (async-safety).

## Testing navigation

- Route tests render through `renderRouterWithProviders(routes, { initialUrl })` from
  `@test/render-router-with-providers` (unit-and-component-tests): the app's providers around
  Expo Router's in-memory router, with `getPathname()`, `getSegments()` and `getSearchParams()`.
  Expo's SDK 57 testing guide shows `expect(screen).toHavePathname()`, which throws with RNTL 14; the
  helper's getters replace it.
- Mount small stand-in routes (`{ _layout: StackLayout, index: ListStandIn, 'tasks/[taskId]/edit':
  EditorStandIn }`) and drive the router with `await act(() => { router.back(); })`.
- A route test lives in the feature (`src/features/<feature>/<feature>-navigation.test.tsx`), never in
  `src/app/`.
- Android-only behaviour (the back button) goes in `<unit>.android.test.tsx`, which runs in the
  `android` Jest project (`jest-expo/android`) where `BackHandler` is the real module:
  `DeviceEventEmitter.emit('hardwareBackPress')` presses Back.
- Jest cannot show the real swipe, the sheet or the predictive animation: e2e-maestro presses them on
  a named iOS simulator and a named Android emulator.

## Verified facts and versions

Verified on 2026-10-10 in this library's reference Expo app: Expo SDK 57
(expo 57.0.26), expo-router 57.0.24, React Native 0.86.3, React 19.2.3, react-native-screens 4.26.2,
TypeScript 6.0.3, Jest 29.7 with jest-expo 57 and RNTL 14.0.1. Every template passes `tsc`, ESLint
`--max-warnings 0`, Prettier and its Jest tests there (the protected-route facts, `dismissTo` vs
`navigate`, the discard guard on iOS and Android, the not-found route, the params parser).

Read in source, not verified on a device: `preventNativeDismiss` while removal is prevented
(`node_modules/expo-router/build/react-navigation/native-stack/views/NativeStackView.native.js`),
Android presentation fallbacks (`node_modules/react-native-screens/lib/typescript/types.d.ts`),
`fullScreenGestureEnabled` true by default from iOS 26 (expo-router's native-stack types).

Re-verify on a new SDK: `npm view expo-router@<sdk> version`, then run the template tests
(`npx jest src/features/not-found src/features/root-navigator src/features/task-editor
src/features/task-detail --selectProjects unit android`, paths first: `--selectProjects` takes every
following word as a project name), and read the SDK's "Prevent screen removal", "Protected routes"
and "Typed routes" pages (`https://docs.expo.dev/router/advanced/protected.md`).

## Pitfalls seen before

- **`reloadAppAsync` while the bundle is still evaluating** crashed a Release build ("startSurface
  failed. Global was not installed"). A restart runs from a mounted component (rtl-and-direction's
  gate does).
- **`await renderRouter(...)`** loses the route getters and leaves fake timers on (expo-router 57.0.24,
  RNTL 14.0.1): use the helper.
- **A test file in `src/app/`** shipped in the production bundle.
- **Typed routes "on" but never generated in CI**: `tsc` passes with untyped hrefs. Generate them
  first (`npx expo customize tsconfig.json`).
- **`usePreventRemove` mistaken for persistence**: it cannot see a kill or a crash.
- **A redirect-based sign-in gate** renders the guarded screen before the redirect runs and leaves
  the signed-in screens in the history; `Stack.Protected` removes them (the protected-routes test
  pins it).
