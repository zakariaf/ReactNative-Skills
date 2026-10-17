# The route contract and check-navigation

`contracts/navigation.json` is the app's route table: the one place that says which routes exist,
which are guarded, which are modals, which take params and which are still placeholders.
`scripts/check-navigation.mjs` compares the code with it and with the rules of SKILL.md. The facts
belong to the app; the checker stays strict.

## Contents

- Running it
- The contract, key by key
- The rules
- Configuration and multi-package
- What a passing run prints

## Running it

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-navigation.mjs .              # every rule
node ${CLAUDE_SKILL_DIR}/scripts/check-navigation.mjs . --release    # also: no placeholder left (a ship gate)
node ${CLAUDE_SKILL_DIR}/scripts/check-navigation.mjs . --json       # also the problems as JSON
```

Exit 0 pass, 1 problems, 2 bad input (no `package.json`, a contract that is not valid JSON). It
prints `NOT APPLICABLE: neither expo-router nor @react-navigation/native is in package.json` for an
app without a router. The router comes from the contract's `router`; without a contract (itself a
`contract` problem), from `package.json` (expo-router first), and the rules that need no contract
still run.

## The contract, key by key

Start from `templates/contracts/navigation.json` (schema beside it). Route ids:

- **Expo Router:** the route file's path under the routes folder without the extension:
  `(app)/index`, `(app)/tasks/[taskId]`, `+not-found`. `_layout`, `+html`, `+native-intent`,
  `+middleware` and `+api` files are not routes; `name.ios.tsx` and `name.android.tsx` count once.
- **React Navigation:** the screen name of the static config: `Home`, `TaskDetail`.

| Key | Router | Meaning | Rules |
|---|---|---|---|
| `router` | both | `"expo-router"` or `"react-navigation"`; must match `package.json` | `contract` |
| `home` | both | Expo Router: the href of the first screen (`"/"`); React Navigation: its screen name. Going there is never `navigate`/`push` | `home-route`, `go-back` |
| `routes` | both | every route id, once | `route-table` |
| `protected` | Expo Router | `[{ "file", "guard", "screens" }]`: each `Stack.Protected` group; `file` is the repo path that writes it (a layout or a component a layout renders, such as `src/features/root-navigator/app-stack.tsx`), `guard` the guard expression as written, `screens` the `name` of every `Screen` inside (nested groups included) | `protected-guard`, `debug-gated` |
| `groups` | React Navigation | `[{ "name", "if", "screens" }]`, in order: the static config's groups with their `if` hooks and screens | `group-if`, `home-route` |
| `guarded` | both | `[{ "route", "hook", "gesture"? }]`: screens with unsaved or in-progress work; `hook` is the repo path of the file that calls `usePreventRemove` (or a hook that does, one import deep); `"gesture": "off"` also turns the iOS swipe off | `guarded-prevent-remove`, `guarded-gesture-off` |
| `modals` | both | routes presented modally (`modal`, `formSheet`, `pageSheet`, `fullScreenModal`, `transparentModal`, `containedModal`, `containedTransparentModal`) | `modal-presentation` |
| `paramParsers` | Expo Router | `{ "<dynamic route id>": "<repo path of its valibot parser>" }`, every dynamic route | `params-parsed` |
| `debugRoutes` | both | Expo Router: route ids; React Navigation: `{ "route", "file" }` (the component file that renders `TEST_ONLY`) | `debug-gated` |
| `placeholders` | both | routes that still render the placeholder screen; empty before a release | `placeholder-route`, `placeholder-release` |
| `placeholderComponent` | both | the placeholder's component name (default `PlaceholderScreen`) | same |
| `jsStack` | both | `true` allows the JavaScript stack; give the reason in `$comment` | `native-stack` |
| `navigatorFile`, `containerFile`, `typesFile`, `paramsFile` | React Navigation | default `src/features/root-navigator/{root-stack.tsx, navigation-root.tsx, react-navigation.d.ts, route-params.ts}` | `route-table`, `static-container`, `typed-routes`, `params-serialisable` |

Unknown keys are a `contract` problem (a typo would silently switch a rule off).

## The rules

| Rule | Router | Fails when | Fix |
|---|---|---|---|
| `contract` | both | the contract is missing, has an unknown key or a bad value, or names a router `package.json` lacks | copy the template, follow the schema |
| `route-table` | both | a route file (or static screen) is not in the contract, or a contract route has no file (screen) | add it to the contract first, then the code |
| `home-route` | both | `home` matches no route; React Navigation: `home` is not the first screen of its group | fix `home` or the order |
| `root-layout` | Expo Router | no `src/app/_layout.tsx`, no default export, or neither it nor a component it renders (followed through local imports, six levels) draws `Stack`/`Tabs`/`Slot`/`Drawer`/`NativeTabs` | render the root Stack through app-startup-and-bootstrap's root skeleton (`AppRoot` > `RootStack` > `AppStack`) |
| `not-found` | Expo Router | no `+not-found` route at the root of the routes folder | copy the template route and its feature |
| `one-navigator` | both | Expo Router: a `@react-navigation/*` import, `<NavigationContainer>`, `createStaticNavigation`, or `create*Navigator` outside a `withLayoutContext` file; React Navigation: an `expo-router` import or a second `createStaticNavigation` outside `containerFile` | one tree: a route file, or a nested static navigator |
| `static-container` | React Navigation | `<NavigationContainer>` anywhere, or no `createStaticNavigation` | render the static navigation component |
| `native-stack` | both | an import of `expo-router/js-stack` or `@react-navigation/stack` without `"jsStack": true` | the native stack |
| `typed-routes` | both | Expo Router: no app config or `experiments.typedRoutes` not true; React Navigation: the types file is missing or does not extend `StaticParamList<typeof rootStack>` | turn typed routes on |
| `href-cast` | Expo Router | `as Href` in app code (tests may) | a typed path or an object href |
| `flow-by-guard` | both | Expo Router: a `<Redirect>` or a `router.*`/`navigation.*` call inside an effect in a layout or a component a layout renders; React Navigation: `navigation.reset()` / `CommonActions.reset()` in app code | a guard (`Stack.Protected`, a group `if`) fed by a store |
| `protected-guard` | Expo Router | a contract group has no matching `Stack.Protected` (same file, same guard text), its screens differ, or a code group is not in the contract | make code and contract agree |
| `group-if` | React Navigation | the groups differ from the contract in names, order, `if` hooks or screens | same |
| `guarded-prevent-remove` | both | a guarded route's hook file is missing or never calls `usePreventRemove` (itself or through one imported local hook), or the route does not exist | call the guard in the model hook |
| `guarded-gesture-off` | both | a `"gesture": "off"` route lacks `gestureEnabled: false` and `fullScreenGestureEnabled: false` in its screen options (its `Stack.Screen` in a parent layout, its layout's `screenOptions`, or a `Stack.Screen` it renders itself) | set both |
| `modal-presentation` | both | a contract modal has no modal `presentation`, or a route with one is not in `modals` | make them agree |
| `params-parsed` | Expo Router | a dynamic route has no parser in `paramParsers`, the parser file is missing or does not import valibot, a key is not a route, or app code passes a type argument to `useLocalSearchParams`/`useGlobalSearchParams` | parse raw params with valibot |
| `params-serialisable` | React Navigation | the params file holds a function type, `Date`, `Map`, `Set`, `Promise` | ids and plain data |
| `go-back` | both | `router.navigate(home)`/`router.push(home)` (a string or `{ pathname: home }`)/`<Link href={home}>` without `dismissTo` (Expo Router), `navigate(home)`/`push(home)` (React Navigation), outside tests. Not seen: an href held in a variable, and `router.replace(home)` deep in the stack (which leaves a second home below; `replace` stays legitimate one screen above home) | `dismissTo`/`popTo` or `back` |
| `nav-in-screens` | both | a value import of `expo-router` (not `expo-router/server`) or `@react-navigation/*` in `src/ui`, `src/stores`, `src/services`, `src/data`, `src/api` or `src/core`; a root kit module (`*-root-kit.tsx`, app-startup-and-bootstrap's slots) is exempt: its effects route notification taps below the navigator | pass `onPress`; navigate in the model hook (or, for a notification tap, in the kit's effects) |
| `debug-gated` | both | a debug route does not mention `TEST_ONLY`, or is not inside a protected group (Expo Router) / a group with an `if` hook (React Navigation) | gate and guard it |
| `placeholder-route` | both | a route renders the placeholder without being listed, or a listed one renders its real screen | keep the list true |
| `placeholder-release` | both | `--release` and any route renders, or the contract lists, a placeholder. As a ship gate, `--release` never prints NOT APPLICABLE: without a router in `package.json` it exits 2 | build the screens |
| `motion-transition` | React Navigation | the static stack is not wrapped with `.with()` whose options call `useScreenAnimation()` (or `useReduceMotion()` with a `'fade'`) | wrap it (examples/react-navigation/navigation-root.tsx) |

With Expo Router, the reduce-motion transition of every `<Stack>` is motion-and-animation's
`screen-transition-reduced`, the navigator's direction is rtl-and-direction's, and the navigation
theme is design-system-structure's; this checker does not repeat them.

One header strategy per stack (the native header or the app's own top bar, set once in
`screenOptions`) is judgement, not a rule: no checker rule flags a `headerShown` set per `Stack.Screen`
against its stack's `screenOptions`, because a modal or a full-screen media route may differ on
purpose. Review it in the layout files.

What the checker cannot see, and the tests cover: that a guard really flips with the store, that the
discard dialog appears, that `dismissTo` really returns (the template tests), and the device-level
swipe and predictive back (e2e-maestro).

## Configuration and multi-package

| Where | Key | Default | Meaning |
|---|---|---|---|
| option | `--contract <file>` | `<contractsDir>/navigation.json` | another contract path |
| option | `--routes-dir <dir>` | `routesDir` (`src/app`, or `app/` when `src/app` is missing) | the Expo Router routes folder |
| `rn-skills.config.json` | `navigationContract` | as above | the contract path for every run |
| `rn-skills.config.json` | `srcDir`, `routesDir`, `uiDir`, `storesDir`, `servicesDir`, `dataDir`, `apiDir`, `coreDir`, `contractsDir` | the canonical layout | where the scanned folders live |

The scan covers `<srcDir>/**/*.{ts,tsx,js,jsx}`, skipping installed skills (any folder holding a
`SKILL.md`, `.agents/`, `.claude/`, `skills/`), `node_modules` and generated native folders.

**When multi-package:** run the checker once per app with the app folder as the repo root
(`node .../check-navigation.mjs apps/mobile`), each app with its own `contracts/navigation.json`.
Shared packages hold no routes and no navigation calls.

## What a passing run prints

```
check-navigation: <n> files checked, 0 problems
RESULT: PASS
```

No SKIP lines: every rule's target is this skill's own (the contract, the routes, the guards), so a
missing one is a problem, never a skip.
