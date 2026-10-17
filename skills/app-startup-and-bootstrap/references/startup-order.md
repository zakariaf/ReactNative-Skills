# The canonical startup order

What runs between the tap on the icon and the first usable screen, in which file, owned by which
skill, and why in that order. Verified on 2026-10-10 against Expo SDK 57 (`expo` 57.0.26,
`expo-router` 57.0.24, `expo-splash-screen` 57.0.9), React Native 0.86.3 and React 19.2.3 by reading
the installed sources (re-verify: `npm ls expo expo-router expo-splash-screen react-native` and the
files named below).

## Contents

1. The order at a glance
2. Phase A: the entry (`index.ts`)
3. Phase B: the root layout's imports
4. Phase C: RootLayout's first render (no I/O)
5. Phase D: the direction gate
6. Phase E: AppRoot's startup initializer
7. Phase F: hooks and providers
8. Phase G: the first frame and the splash release
9. Phase H: after the splash
10. Phase I: leaving the foreground
11. Why a reload re-runs everything (and what that forbids)
12. Strict Mode, Fast Refresh and the initializer
13. When there is no Expo Router (React Navigation appendix)
14. When multi-package
15. The slots: optional root kits

## 1. The order at a glance

| # | Step | File | Owner of the piece | May write? |
|---|---|---|---|---|
| A1 | Intl polyfills (forced, the app's languages only) | `index.ts`, first import | i18n-strings-and-catalogs | no |
| A2 | `import 'expo-router/entry'`, last | `index.ts` | this skill (order), architecture-and-boundaries (thin entry) | no |
| B1 | Error net installer, the first app import | `src/app/_layout.tsx` | error-handling-typed-results | no |
| B2 | Splash hold (`preventAutoHideAsync()` at module scope) | `src/features/root-navigator/hold-splash.ts`, imported second | this skill | no |
| B3 | Every import with bindings (modules evaluate, nothing runs) | `src/app/_layout.tsx` | architecture-and-boundaries (nothing at import time) | no |
| C1 | Composition root: adapters, no I/O; then the cold-start mark | `createDeviceServices()` in `decideStartup`, then `markJsEntry(services.perf.epochMs())` | architecture-and-boundaries, performance-budgets | no |
| C2 | Checked public config (`EXPO_PUBLIC_*` through `src/config` readers) | passed to `createDeviceServices(...)` | app-variants-and-environment, networking-and-server-state | no |
| C3 | Language: saved choice, else device, else source | `resolveLanguage(readSavedLanguage(...), getLocales())` | i18n-strings-and-catalogs, settings-and-preferences | no |
| D1 | `DirectionGate`: keep, restart once, or give up | the root layout's outermost element | rtl-and-direction | guard only |
| E1 | The registry's prepared ports (a test build wraps the clock and connectivity here, its switches read from a test-only key-value store), then open the data layer: file, migrations, repositories, SQLite error log | `prepareRootKits(device)`, then `openDeviceData(services)` in `startApp` | this skill (the slot), debug-menu-and-test-hooks (the test hooks); persistence-and-migrations | **first write** |
| E2 | Connect the error net's sink (flushes the buffer) | `appErrorNet.connect(...)` in `startApp` | error-handling-typed-results | yes |
| E3 | QueryClient | `createQueryClient(...)` in `startApp` | networking-and-server-state | no |
| E4 | Settings store (synchronous read) | `openDeviceSettings(data.errorLog)` | settings-and-preferences | yes |
| E5 | Domain stores (hydrate from repositories) | `createStores({ tasks: data.tasks })` | state-management-zustand | no |
| E6 | Start-only work (sound bank load, subscriptions), then the optional kits from the registry, attached to the error sink | `services.audio.load(...)`, `connectSoundSettings(...)`; `createRootKits(...)`, `errors.attach(kits)` | audio-and-haptics-feedback; each kit's skill (crash reporting, analytics, push, local notifications) | no |
| E7 | The startup gate (async work the first screen needs, under one deadline; the kits' tasks included) | `createStartupGate({ blocking: kitBlocking(kits), ... })` + `start()` | this skill | per task |
| F1 | Lifecycle hooks: flush, then checkpoint | `useFlushOnBackground`, `useCheckpointOnBackground` | this skill, persistence-and-migrations | on background |
| F2 | System accessibility store | `watchSystemA11y(...)` in an effect | accessibility-as-code | no |
| F3 | Splash release once the gate is ready | `useStartupReady(gate, hideSplash)` | this skill | no |
| F4 | Providers, outermost first | services, data, query, settings, stores, preferences (i18n, theme, text locale), root stack | this skill (order); each provider its skill | no |
| F5 | Root stack: gesture root, keyboard, `RootMotion` (MotionConfig, or a kit's motion slot), navigation theme, session, feedback, ads, games, then `AppStack`: the test-build `(debug)` group behind `Stack.Protected` (open while a kit sets `opensDebugRoutes`) and the kits' providers (`RootKits`) around the `Stack` | `root-stack.tsx`, `root-motion.tsx`, `app-stack.tsx`, `root-kits.tsx` | this skill (the files and order); route groups and guards: navigation-and-routing; each provider its skill | no |
| F6 | Navigation from outside, below the navigator: the link gates (`useLinkGate(gate, isOpen)` where each guard is decided), and the kits' effects beside the `Stack` (push and reminder tap routers, consent appliers, route breadcrumbs, screen views) | the component that owns a guard; `RootKits` in `app-stack.tsx` | deep-links-and-universal-links; push-notifications, local-notifications, crash-reporting-and-observability, analytics-and-consent | no |
| G1 | First frame; Expo Router's navigation ready; the held splash hides on F3; the first screen's model records the cold-start mark once its real data shows | `useColdStartMark({ perf, perfLog, label, isReady })` | performance-budgets | no |
| H1 | Deferred work: consent refresh, entitlement re-check, OTA check, prefetch | the feature that owns it, after `isReady` | admob-ads-and-consent, in-app-purchases, ota-updates | through its own paths |
| I1 | Leaving the foreground: flush every buffered writer (the kits' flushers included), then fold the WAL | `useFlushOnBackground` | this skill | yes |

The provider order (F4) is what `contracts/startup.json` `appRootOrder` lists, and what
`check-startup` enforces (`provider-order`, `provider-once`).

## 2. Phase A: the entry (`index.ts`)

`package.json` `"main": "index.ts"`. ES imports evaluate in order, so the entry is a list of imports
whose order is the contract: the forced Intl polyfills first (Hermes has no `Intl.PluralRules` or
`Intl.Locale`, and the first module that formats a message must find them), `expo-router/entry` last.
A module imported after the router entry evaluates after the router's entry has already required
`expo-router`'s root and scheduled the registration of the root component; whatever it installs can
be late for the root layout's imports (`entry-router-last`).

An app without polyfills keeps `"main": "expo-router/entry"` and has no `index.ts`.

## 3. Phase B: the root layout's imports

`src/app/_layout.tsx` begins with two side-effect imports, in this order:

```ts
import '@/services/error-net/install-error-net';   // B1: catches a module that throws while loading
import '@/features/root-navigator/hold-splash';     // B2: holds the native splash
```

An optional third side-effect import, only in apps that adopt privacy-and-store-declarations' test
network guard, follows the error net: `import '@/services/test-hooks/install-network-guard';` (it
calls `TEST_ONLY?.installNetworkGuard(...)`, so production loads nothing). It has no bindings, so
`root-import-order` accepts it before or after the hold; the error net stays first.

The error net comes first because a module that throws while it loads (a bad import, a top-level
`throw`) must already find the global handler. The splash hold comes second because it is the one
piece of startup work that must run at module scope (see the splash reference) and its own rejection
must reach the net. Every other import comes after them (`root-import-order`), and none of those
modules does work at import time (architecture-and-boundaries).

## 4. Phase C: RootLayout's first render (no I/O)

`RootLayout` keeps one value in a `useState` initializer: `decideStartup()` returns the services
(adapters only: creating an adapter opens nothing) and the language. The checked public config is read
here, because a missing `EXPO_PUBLIC_*` value should fail the first launch of a misconfigured build,
not a screen three taps in. The saved language is read with one synchronous key-value read
(settings-and-preferences' `readSavedLanguage`), never by opening the database.

Why no I/O here: the next element may restart the JS runtime for the layout direction. Anything opened
or written in this run is opened or written again in the next one.

## 5. Phase D: the direction gate

`DirectionGate` (rtl-and-direction) is the outermost element the root layout renders (when the app
ships the web, it sits directly inside web-support's `WebStorageGate`, which renders its children on
the first render on iOS and Android and warms the browser's SQLite storage up first on the web). It renders
either `DirectionRestart` (an empty screen that flips the direction once it is mounted and reloads) or
its children. The held splash covers the restart screen, so the person sees splash, then the app in
the right direction: never a frame of the wrong layout. check-rtl's `direction-before-render` fails
any startup call (`openDeviceData`, `openDatabaseSync`, ...) in the component that renders the gate.

## 6. Phase E: AppRoot's startup initializer

`AppRoot` is the gate's child. Its first render runs `startApp(services, language)` once, as
`useState(() => startApp(services, language))`, synchronously and in this order:

0. `prepareRootKits(device)` (the registry, section 15): the ports every reader uses from here on,
   the device services unchanged, or a test build's with the simulated clock and connectivity
   swapped in (debug-menu-and-test-hooks). startApp hands `prepared.services` to the data layer, the
   kits and `ServicesProvider`; check-startup's `root-kits` fails a call after the open.
1. `openDeviceData(services)`: opens the file, runs migrations (with the snapshot before them),
   builds the repositories and the SQLite error log. The open is synchronous (`openDatabaseSync`), so the
   first frame already has the rows. Once per JS run, only here (`storage-open-once`).
2. `appErrorNet.connect(errors.sink)` with `errors = createKitErrorSink(data.errorLog)`: the buffered
   reports of phases A to D land in the error log now, before any provider renders
   (`sink-before-providers`); the sink keeps them for the kits too.
3. The QueryClient, the settings store, the domain stores: each reads what it needs synchronously.
4. Start-only work, such as the sound bank load (idempotent, so a second call is harmless), then the
   optional kits: `createRootKits({ services, data, language, prepared })` (plus the settings or the session an
   app's kit reads) and `errors.attach(kits)`, which replays the kept reports to the kits that forward
   them (crash reporting). Section 15.
5. `createStartupGate({ blocking: kitBlocking(kits), deadlineMs, errorLog })` and `gate.start()`.

`startApp` returns everything the tree needs: the prepared services, data, settings, stores, the
kits, the gate, the flushers (`kitFlushers(kits)` plus the app's own).

## 7. Phase F: hooks and providers

The hooks run in a fixed order because `AppState` calls its listeners in subscription order:
`useFlushOnBackground(flushers, errorLog)` before `useCheckpointOnBackground(database)`, so on the
shared `background` event the writes land before the WAL is folded (`flush-root`). Then
`watchSystemA11y(...)` in an effect, then `useStartupReady(gate, hideSplash)`.

While the gate is not ready, AppRoot returns `null` under the held splash (`blank-frame` fails a
`return null` in a startup component when nothing holds the splash). When it is ready, the providers
render outermost first:

```
ServicesProvider | AppProviders      ports (AppProviders: services, data, query in one component)
  AppDataProvider                     repositories, database status, reset
    QueryProvider                     server-state cache (needs the ConnectivityPort)
      SettingsStoreProvider           the settings store
        StoresProvider                the domain stores
          PreferencesRoot             settings-driven I18nProvider > AppThemeProvider > ReduceMotionPreferenceContext > TextLocaleProvider
          (or, without settings: I18nProvider > AppThemeProvider > TextLocaleProvider)
            RootStack                 GestureHandlerRootView > KeyboardProvider > RootMotion (the one MotionConfig, with the preference above it: "system", or PreferencesRoot's) > NavigationThemeProvider > AppStack (Stack.Protected (debug); RootKits > Stack)
```

The root stack (`root-stack.tsx`) with every provider another skill may add, outermost first; each
is mounted once, and `rootStackOrder` lists them all. The canonical file already renders the gesture
root, `KeyboardProvider`, `RootMotion` and the navigation theme; the rest are optional:

```
GestureHandlerRootView                the one gesture root (canvas-gestures-and-hit-testing)
  KeyboardProvider                    react-native-keyboard-controller (forms-and-input)
    MotionConfig | RootMotion         reduce motion (accessibility-as-code): RootMotion renders the one
                                      MotionConfig, or a kit's motion slot in its place (the test build's
                                      TestHooksRoot, debug-menu-and-test-hooks)
      NavigationThemeProvider         headers and screen backgrounds (design-system-structure)
        SessionProvider               the one session, created in startApp (auth-and-secure-storage)
          AppFeedback                 the one FeedbackProvider host, so a notice survives navigation
                                      (ui-states-and-feedback)
            AdsRoot                   AdsProvider and the consent primer (admob-ads-and-consent)
              GamesRoot               the game hosts, created once from the services and AppData
                                      (game-session-host, the optional games plugin)
                AppStack              RootKits (the kits' providers, outermost first, around the Stack;
                                      their effects beside it), then the root Stack, its test-build
                                      (debug) group behind Stack.Protected (opensDebugRoutes) and its
                                      route groups (navigation-and-routing)
```

Test hooks (debug-menu-and-test-hooks) go through the slots like every other kit: the registry's
`prepareRootKits` calls `TEST_ONLY?.createTestHooks(...)` once and returns `testHooks?.services ??
device`, never both, and `createRootKits` registers `TEST_ONLY?.createDebugKit(hooks)`, whose motion
slot puts `TestHooksRoot` in `MotionConfig`'s place and whose `opensDebugRoutes` opens the `(debug)`
group. Nothing of it runs at import time, and the root files hold no `TEST_ONLY` code: only the
app's registry reads the gate, so an app without the debug kit compiles and runs the same files.

Each provider reads only those outside it: `QueryProvider` reads the ports, `PreferencesRoot` reads
the settings store, the theme's text primitives read the language, the navigation theme reads the app
theme. A provider in the wrong place throws "needs a provider above it" only when that path renders,
often on a device. Each provider is mounted once (`provider-once`; the alternatives of one
`rootStackOrder` entry, `MotionConfig|RootMotion`, count as one provider): `PreferencesRoot` hands the
saved reduce-motion choice down as `ReduceMotionPreferenceContext`, never a `MotionConfig` of its own,
and the root stack's `RootMotion` renders the app's one `MotionConfig` with it; a second one would
override the person's in-app setting and fight over Reanimated's global mode. The JSX depth limit (`react/jsx-max-depth` 5) is why the stack's wrappers live
in `root-stack.tsx` and the outer providers may move into `AppProviders`.

## 8. Phase G: the first frame and the splash release

Expo Router calls its internal splash hold in a `setTimeout` after the entry ran, renders the root
layout, and, when the navigation container is ready, asks the native module to hide the splash on the
next animation frame. The native module hides it only if nobody called `preventAutoHideAsync()`.
Because the app held it (B2), the splash stays until `useStartupReady` calls `hide()` in an effect
after the commit of the tree that is shown. Details and both platforms: the splash reference.

**Incoming links and notification taps** (F6). Expo Router calls `+native-intent`'s
`redirectSystemPath` for the launch URL while it builds its linking state, outside React and before
any of this tree can answer: so the gate is synchronous, reads no services and no stores, and a link
into a guarded group waits in deep-links-and-universal-links' pending-link inbox until
`useOpenPendingLink(gate)` opens it from the first screen behind the guard. Notification taps never
pass through that gate: each tap hook reads the launch tap and listens for later ones from inside the
navigator (navigating before the root layout mounted throws), clears only its own taps and maps ids
to a typed href (push-notifications, local-notifications); those hooks run in the kits' effects,
which `RootKits` mounts beside the `Stack` after the splash release. Neither path holds the splash or
joins the startup gate. A reload (section 11) re-delivers the launch URL, which is one more reason a link never
acts on arrival.

## 9. Phase H: after the splash

Work the first screen does not need starts after the release, from the component or service that owns
it: the consent refresh, the entitlement re-check, the OTA update check, a prefetch, connectivity. Each
goes through its own path (a Result, its own timeout) and never through the startup gate. The
deferred-work reference lists where each kind belongs.

## 10. Phase I: leaving the foreground

`useFlushOnBackground` runs every registered flusher on the transition out of `active`, before the
checkpoint. The lifecycle reference has the iOS and Android event sequences.

## 11. Why a reload re-runs everything (and what that forbids)

`reloadAppAsync` (a direction flip, the crash fallback's restart, an OTA `reloadAsync`) throws away the
JS runtime and evaluates the bundle again from `index.ts`. Every module body and every initializer of
the first render runs again. Hence:

- nothing at module scope opens, writes or subscribes (architecture-and-boundaries), except the splash
  hold, which opens nothing and is safe to repeat;
- nothing before the gate writes, except the direction guard (rtl-and-direction);
- calling `reloadAppAsync` while the bundle is still evaluating (from a module body, before the root
  component is registered) crashed a Release iOS build with "AppRegistryBinding::startSurface failed.
  Global was not installed" in the source app; the restart runs from a mounted component's effect,
  which `DirectionRestart` does.

## 12. Strict Mode, Fast Refresh and the initializer

Neither `expo` 57 (`registerRootComponent`) nor `expo-router` 57.0.24 wraps the root in
`<StrictMode>` (read in their sources on 2026-10-10). React calls a `useState` initializer twice in
development under Strict Mode and keeps one result, so a `<StrictMode>` around `AppRoot` would open the
database twice in development. If the app wants Strict Mode, put it inside AppRoot, around
`RootStack`. Fast Refresh re-runs an edited module while components keep their state, which is one more
reason nothing is created at module scope: the store on screen and the one a re-run module created
would differ.

## 13. When there is no Expo Router (React Navigation appendix)

An app on React Navigation 7 has `index.ts` ending in `registerRootComponent(App)` and an `App.tsx`
that plays the root layout. Set `"rootLayout": "App.tsx"` in `contracts/startup.json`; the same order
holds: error net and splash hold as the first imports of `App.tsx`, `DirectionGate` outermost, the app
root inside it, `NavigationContainer` inside the providers (in the root stack's place). Without Expo
Router nothing hides the splash at "navigation ready": the native module hides it when content first
appears, unless the app held it, so the hold and release work the same way.

## 14. When multi-package

Run `check-startup` with `--app-dir apps/<app>`; every path (contract, layout, routes) is then
relative to that app folder, and the app's own `tsconfig.json` aliases resolve imports. Shared
packages hold no startup code: the composition root, the gate and the root are the app's.

## 15. The slots: optional root kits

The root skeleton is canonical: every skill cites the same `_layout.tsx`, `app-root.tsx`,
`root-stack.tsx`, `app-stack.tsx` and `metro.config.js`, and the library's reference app checks them
byte for byte. An optional kit (crash reporting, analytics, push and local notifications, a test
build's debug and parity kits) therefore never edits them. It plugs into typed slots, each a no-op
while no kit fills it:

| Slot | Startup step | Where the skeleton reads it | What fills it |
|---|---|---|---|
| `prepareRootKits(device)` (the registry's own function, not a kit part) | E1 | `startApp`'s first statement: `const prepared = prepareRootKits(device); const { services } = prepared;`, before `openDeviceData(services)`; `prepared` rides along in `RootKitsInput` | a test build's hooks (debug-menu-and-test-hooks: the simulated clock and connectivity, the network guard); the template returns the services unchanged |
| `forward(report)` | E2 | `createKitErrorSink(data.errorLog)`: records every report, then forwards it to each attached kit; reports caught before the kits existed (at most 50) are replayed by `errors.attach(kits)` | crash reporting (`createCrashForwarder`: render errors and rejections) |
| `blocking` | E7 | `createStartupGate({ blocking: kitBlocking(kits) })` | a kit's non-interactive async read the first screen needs (rare) |
| `flushers` | I1 | `flushers: kitFlushers(kits)` for `useFlushOnBackground` | analytics (`analyticsFlusher`) |
| `motion(props)` | F5 | `RootMotion` in `root-stack.tsx`: the first kit's motion slot renders in `MotionConfig`'s place with the preference above it (at most one; never a second MotionConfig below the first) | the test build's debug kit (`TestHooksRoot`: the debug motion switch holds every animation still) |
| `opensDebugRoutes` | F5 | `AppStack`: `<Stack.Protected guard={isTestBuild}>` around `(debug)`, `isTestBuild = kitsOpenDebugRoutes(kits)`; with no such kit the guard is false (a production build registers none of the group; Expo Router ignores the protected name in an app with no `(debug)` routes) | the test build's debug kit |
| `provide(children)` | F5 | `RootKits` in `app-stack.tsx`, the first kit outermost, around the `Stack` and every kit's effects | analytics (`useAnalytics`), push (`usePushServices`), local notifications (`useReminderSyncService`), the test build's parity kit (`ParityFrameRoot`) |
| `effects` | F6 | `RootKits`, beside the `Stack`, after the splash release, inside every provider and the navigator | consent appliers and route breadcrumbs (crash reporting), screen views (analytics), the sync and tap routers (push, local notifications), the iOS parity launch bridge (the test build's parity kit) |
| `MetroKit` (`baseConfig`, `transform`) | build | `metro.config.js`: `composeMetroConfig(__dirname, getDefaultConfig, readMetroKits(__dirname))`, then `cacheVersion` | crash reporting (`getSentryExpoConfig`) |

The app's registry, `src/services/create-root-kits.ts`, is the one file a kit edits: it creates the
kit's adapters (no I/O; it is part of the composition root, so it may import adapters) and returns the
list of kits in nesting order. `startApp` calls it once per JS run, after the stores, so a kit may
read the data layer, the settings or the session the app passes in (its own `RootKitsInput`). A kit's
port reaches the code that needs it through the kit's own provider (`useAnalytics()`), not through
`Services`, which stays the canonical three ports. The Metro registry, `scripts/metro/metro-kits.ts`,
is optional: without it the config is Expo's default. A kit module is
`src/services/<concern>/<concern>-root-kit.tsx` (a test-only kit lives in its test-only folder,
`src/features/debug/debug-root-kit.tsx`, `src/features/parity/parity-root-kit.tsx`, and is reached
only through the test-only gate, `TEST_ONLY?.create<X>Kit`); check-startup's `root-kits` fails a root
file that imports one, and navigation-and-routing lets only these modules route a notification tap
from a shared layer.

What stays in `startApp` itself: the app's own startup (the query client, the settings, the stores,
the session), which every app shapes differently and whose order is the table in section 1.

