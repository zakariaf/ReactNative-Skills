# check-startup: rules, contract, output

`node ${CLAUDE_SKILL_DIR}/scripts/check-startup.mjs [repo-root] [--contract <file>] [--app-dir <dir>] [--json]`.
Zero dependencies (Node 22.18 or newer). Exit 0 pass, 1 problems, 2 bad input. `--help` prints every
rule and default.

## Contents

1. What it reads
2. The rules, with what each catches and the usual fix
3. contracts/startup.json
4. SKIP and NOT APPLICABLE
5. Running it on an app adopted step by step
6. Limits (what it cannot see)

## 1. What it reads

- `package.json`: `main` (the entry) and whether `expo` and `expo-splash-screen` are dependencies.
- The layout from check-lib's `resolveLayout` (`src/`, `src/app/`, `src/features/`, `contracts/`,
  `tsconfig.json` aliases, `rn-skills.config.json` overrides).
- `contracts/startup.json` when it exists (every key optional).
- Every `.ts`/`.tsx` file under the source and routes folders, minus tests and `.d.ts`, through the
  repo walk that never enters `node_modules`, native output or installed skills (`.agents/`,
  `.claude/`, `skills/`, any folder holding a `SKILL.md`).
- The root-kit registry (`src/services/create-root-kits.ts`, the file defining `createRootKits`) and the
  app stack (`app-stack.tsx` beside the root stack), for `root-kits`.
- The startup files: the root layout (`src/app/_layout.tsx`), the app root
  (`src/features/root-navigator/app-root.tsx`; without it the root layout plays both parts), the root
  stack (`src/features/root-navigator/root-stack.tsx`), and the local `.tsx` components the app root
  renders (one level: `AppProviders`, `PreferencesRoot`).

## 2. The rules

| Rule | Catches | Usual fix |
|---|---|---|
| `entry-router-last` | an import after `expo-router/entry` in the entry file | move it above the router import |
| `root-import-order` | the splash hold imported after a module with bindings, or before the error net installer | side-effect imports first: net, hold, then the rest |
| `splash-hold` | no hold while `expo-splash-screen` is a dependency; a hold inside a function; a hold in a module the root layout and entry do not import for its side effect; a second hold | `hold-splash.ts` at module scope, imported second by the root layout |
| `splash-release` | a hold with no release; a release in a second file (the app root's release always counts as the first, so the line names the extra file); at module scope; in a render body; in the component that renders `DirectionGate` | `useStartupReady(gate, hideSplash)` in the app root |
| `blank-frame` | `return null` in a startup component while nothing holds the splash | hold the splash (or render the tree) |
| `startup-await` | `await`, `.then`, `.catch`, `.finally` in the root layout or app root | a blocking task in the gate, or deferred work in its owner |
| `startup-deadline` | `createStartupGate` without `deadlineMs`, with a value the checker cannot read, or over `maxBlockingMs` | a literal or `const STARTUP_DEADLINE_MS = 2000;` |
| `runtime-font-load` | `useFonts` or `loadAsync` from `expo-font` or an `@expo-google-fonts/<family>` package (which re-exports `useFonts`), named or through a namespace (`Font.useFonts`, `Font.loadAsync`), in app code | embed with the expo-font config plugin |
| `sink-before-providers` | `appErrorNet.connect(...)` (any binding imported from an `error-net` module) at module scope, in an effect or callback, in a render body, or in a function no `useState` initializer calls | connect in `startApp`, run by `useState(() => startApp(services))` |
| `provider-order` | a provider outside one listed before it, in the app root, a provider component it renders, or the root stack; a missing root stack file | nest it inside; copy `root-stack.tsx` and `app-stack.tsx` (or set `rootStack`) |
| `provider-once` | a listed provider mounted twice along the root path (`MotionConfig` in both `PreferencesRoot` and the root stack) | keep the one the provider component owns |
| `storage-open-once` | an `openCalls` function called outside the app root, twice, or outside the startup initializer | open once in `startApp` |
| `interaction-manager` | any use of `InteractionManager` | an effect after the splash release |
| `lifecycle-write` | an `AppState.addEventListener` callback calling `flush*`, `save*`, `persist*`, `write*` or `commit*` outside `lifecycleFiles`: an inline callback, or a handler named by identifier (`const onChange = (next) => …` or `function onChange(…)` in the same file) | a `Flusher` handed to the app root |
| `flush-root` | `useFlushOnBackground` defined but never called, called outside the app root, called twice, or after `useCheckpointOnBackground` | one call in the app root, first |
| `root-kits` | a root file (root layout, app root, root stack, app stack) imports a kit factory (`create<Name>Kit`); `createRootKits` defined but never called, called outside the app root, twice, outside the startup initializer, before the open call or before the sink connects; kits created but not handed to every slot (`.attach(`, `kitBlocking(`, `kitFlushers(`, `<RootKits kits=...>`); `<RootKits>` rendered twice | register the kit in `src/services/create-root-kits.ts`; the template's `startApp` and `app-stack.tsx` |

## 3. contracts/startup.json

Template: `templates/contracts/startup.json` (schema beside it). Every key is optional; a missing file
means the defaults.

| Key | Default | Meaning |
|---|---|---|
| `rootLayout` | `<routesDir>/_layout.tsx` | the root layout; `App.tsx` for React Navigation |
| `appRoot` | `<featuresDir>/root-navigator/app-root.tsx` | the startup component below the gate |
| `rootStack` | `<featuresDir>/root-navigator/root-stack.tsx` | the component around the root navigator |
| `appRootOrder` | `ServicesProvider\|AppProviders`, `AppDataProvider`, `QueryProvider`, `SettingsStoreProvider`, `StoresProvider`, `PreferencesRoot`, `I18nProvider`, `AppThemeProvider`, `TextLocaleProvider`, `RootStack` | outermost first; `A\|B` accepts either; a listed element absent from a file is not required |
| `rootStackOrder` | `GestureHandlerRootView`, `KeyboardProvider`, `MotionConfig\|RootMotion`, `NavigationThemeProvider`, `SessionProvider`, `AppFeedback\|FeedbackProvider`, `AdsRoot`, `GamesRoot`, `AppStack\|Stack` | the same for the root stack (`RootMotion` is debug-menu-and-test-hooks' test-build stand-in for `MotionConfig`) |
| `maxBlockingMs` | 3000 | the longest gate deadline (1 to 10000) |
| `lifecycleFiles` | `<featuresDir>/root-navigator/use-flush-on-background.ts` | globs allowed to write from an `AppState` listener |
| `openCalls` | `openDeviceData` | functions that open the data layer |

An app adds its own providers to `appRootOrder` or `rootStackOrder` where they belong; the defaults
already place the providers other skills ship (`KeyboardProvider`, `RootMotion`, `SessionProvider`,
`AppFeedback`, `AdsRoot`, `GamesRoot`), and a listed name the app does not use is simply not required. Unknown keys
and malformed values are exit 2.

## 4. SKIP and NOT APPLICABLE

- `NOT APPLICABLE: expo is not in package.json`: not an Expo app.
- No SKIP lines: every file the checker reads is this skill's own (the root layout, the app root, the
  root stack and the startup helpers are the canonical root skeleton). A missing root stack is a
  `provider-order` problem; an app that composes its root stack elsewhere (React Navigation's
  `NavigationContainer` file) names it in `rootStack`.
- The splash rules print a note and do not run when `expo-splash-screen` is not a dependency and no file
  holds the splash (then `blank-frame` guards the empty frame instead).
- A missing root layout is exit 2 ("nothing to check"): it is this skill's own target.

## 5. Running it on an app adopted step by step

Copy the root layout and the app root together (the root layout imports the app root). Until the
data layer exists, replace `openDeviceData` in `startApp` with what the app has and set `openCalls`;
until the error net exists, the sink rule has nothing to check. The checker never needs the other
skills' files to exist: it reads only the startup files and the call sites it looks for.

## 6. Limits (what it cannot see)

- Runtime order inside a callee (a function that awaits internally and is called synchronously): the
  startup gate's tests and a device launch cover that.
- Providers rendered more than one component level below the app root.
- Whether a blocking task truly needs to block: a review question (the deferred-work reference).
- Whether the splash release happens on a device: the release build launch in the definition of done.
- `startup-await` is file-wide by design: it flags a promise in a press handler or in the
  `ErrorBoundary` restart callback of the root layout or the app root too, although those do not run
  on the startup path. Keep the root files free of promise code: move such handlers into the feature
  that owns them, or hand the promise-returning function on unchained, as the template's
  `restart: () => reloadAppAsync('crash-recovery')` does (the boundary handles the result).
- A module-scope `preventAutoHideAsync()` written directly in the root layout (Expo's documented form)
  passes `splash-hold`, but it runs after every module the layout imports with bindings, because ES
  imports evaluate first; `root-import-order` cannot see a hold that is not an import. Prefer
  `hold-splash.ts` imported second, which runs before them.
- `lifecycle-write` reads only the listener's own file. Out of reach: a handler imported from another
  file; a handler annotated with an arrow function type (`const onChange: (next: AppStateStatus) =>
  void = …`; a named type such as `: Handler` is read); a handler reached through an object
  (`AppState.addEventListener('change', handlers.onChange)`); a write one call deeper (the handler
  calls `queueDraft()`, which calls `save`); and an effect keyed on `useIsAppActive()` that calls
  `save*` when the flag turns false. Review a feature's lifecycle code by hand for these: the rule is
  a tripwire for the common shapes, not a proof.
