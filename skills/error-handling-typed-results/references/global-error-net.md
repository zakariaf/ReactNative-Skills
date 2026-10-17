# The global error net and the root error boundary

Facts verified on 2026-10-03 by reading the installed sources of react-native 0.86.3 (Libraries/Core,
Libraries/ReactNative, src/private/renderer, ReactCommon, React/CoreModules, ReactAndroid), expo-router
57.0.24, expo 57.0.26 and @sentry/react-native 7.11.0, and by running the templates' tests under jest-expo
57.0.5. Device behaviour that was read from source, not
observed on a device, is marked as such. Re-verify: `npm ls react-native expo-router @sentry/react-native`
and reread the files named below after an upgrade.

## Contents

1. What reaches the net
2. How React Native 0.86 handles uncaught errors
3. The template net
4. Installing it first
5. Connecting the error log
6. The root ErrorBoundary (Expo Router)
7. Crash loops and the way out
8. Living with a crash reporter
9. React Navigation, web, non-Hermes engines
10. Proving it on a device

## 1. What reaches the net

Only bugs and truly unexpected states. Expected failures are `Result` values and never get here.

| Thrown from | Caught by | Fatal? | Reaches the net? |
|---|---|---|---|
| render, lifecycle, effect setup of a component | the nearest `ErrorBoundary` (a route's export); with none, React's `onUncaughtError`, which calls `ExceptionsManager.handleException(error, true)` directly | caught: no; uncaught: yes | **no**: only the boundary's `record` writes it to the log |
| an event handler (`onPress`), a timer, a native callback | React Native's global handler (`ErrorUtils`) | treated as fatal | yes |
| a module's top-level code while it is first required | Metro's require guard, then `ErrorUtils.reportFatalError` | yes | yes, when the net was installed first |
| a promise nobody handled | Hermes' promise-rejection tracker, when it is enabled | non-fatal | yes (the net enables the tracker) |
| a worklet on the UI thread | not the JS net: catch inside the worklet and hand the error to JS with `scheduleOnRN` | crashes otherwise | no |
| native code (Swift, Kotlin, C++) | the OS and a native crash reporter only | always | no |

Error boundaries do not catch errors in event handlers, asynchronous code, timers or the boundary itself.

**Render errors never pass through the global handler.** React Native 0.86 hands React three callbacks
when it renders the root (`Libraries/ReactNative/RendererImplementation.js` passes `onCaughtError`,
`onUncaughtError` and `onRecoverableError` from `src/private/renderer/errorhandling/ErrorHandlers.js` to
`ReactFabric.render`):

- `onCaughtError`: every render error a boundary caught goes to `ExceptionsManager.handleException(error,
  false)`: LogBox in development, the native log in release. Nothing the app can read.
- `onUncaughtError`: a render error no boundary caught goes to `ExceptionsManager.handleException(error,
  true)`, a fatal crash. Once the runtime is ready, `global.RN$handleException` returns `false`
  (`ReactCommon/react/runtime/ReactInstance.cpp`, with `useAlwaysAvailableJSErrorHandling` off, the 0.86.3
  default), so `handleException` calls `reportException` and `NativeExceptionsManager` itself. **`ErrorUtils`
  is never called, so the net never sees it.**

Two consequences shape sections 6 and 7: the root `ErrorBoundary`'s `record` is the only place a render
error is ever written to the app's error log, and a render error that escapes it (an app without the root
export, or a root fallback that itself throws) is a fatal crash with no error-log entry.

## 2. How React Native 0.86 handles uncaught errors

Read from `Libraries/Core/setUpErrorHandling.js`, `ExceptionsManager.js`, `polyfillPromise.js`:

- At startup React Native sets `ErrorUtils.setGlobalHandler(handleError)`, which calls
  `ExceptionsManager.handleException(error, isFatal)` (the C++ "always available" path is behind the
  `useAlwaysAvailableJSErrorHandling` feature flag, default `false` in 0.86.3).
- **Development:** the exception goes to LogBox (the redbox for fatal errors).
- **Release:** `NativeExceptionsManager.reportException(data)`. For a fatal error, Android's
  `ExceptionsManagerModule` throws a `JavascriptException` (the app crashes); iOS's `RCTExceptionsManager`
  reloads JS up to `maxReloadAttempts` (0 unless the host app sets it; nothing in React Native or Expo does) and then calls `RCTFatal` (the app crashes). A
  non-fatal error is logged to the native log only (read from source; observe it with the recipe in
  section 10).
- **Errors from the JS thread's work loop** (event handlers, timers, native callbacks): the New
  Architecture's `ReactInstance` catches the `jsi::JSError` and calls `JsErrorHandler::handleError(...,
  isFatal = true)`, which calls `ErrorUtils.reportFatalError(error)`, so the global handler sees them as
  fatal (read from `ReactCommon/react/runtime/ReactInstance.cpp` and `ReactCommon/cxxreact/ErrorUtils.h`).
- **Errors while a module is first required** (its top-level code throws) are caught by Metro's require
  guard and reported with `ErrorUtils.reportFatalError` (read from `metro-runtime/src/polyfills/require.js`),
  so the net sees them only when it was installed before that module was required: the reason the
  installer is the first app import. An error that escapes everything while the bundle is still being
  evaluated, before React Native marks the runtime ready, is reported by the C++ pipeline instead
  (`ReactInstance::loadScript` calls `setRuntimeReady()` after `evaluateJavaScript` returns).
- **Render errors** take React's own path to `ExceptionsManager` and skip the global handler (section 1).
- **Unhandled rejections:** with Hermes, React Native enables
  `HermesInternal.enablePromiseRejectionTracker(...)` **only when `__DEV__` is true**. In a release build
  nothing tracks them: an unhandled rejection disappears without a trace. This is the strongest reason the
  net exists.

The consequence for the error log: when a fatal error reaches the handler, the process ends right after
the handler returns. Whatever records it must be **synchronous** (expo-sqlite's sync API, not an
`await`), or the entry never lands.

## 3. The template net

`templates/src/services/error-net/error-net.ts` (`createErrorNet(hooks, options)`), with
`app-error-net.ts` (the app's one instance, reading `globalThis`) and `install-error-net.ts` (installs it
as a side effect of being imported):

- **Chains, never replaces.** It reads `ErrorUtils.getGlobalHandler()`, installs its own handler that
  records `{ source: 'global-handler', error, isFatal }` and then calls the previous handler, so LogBox
  still shows errors in development and a fatal error still crashes in release (a JS context in an
  unknown state must not limp on).
- **Tracks rejections in every build.** It calls `HermesInternal.enablePromiseRejectionTracker({
  allRejections: true, onUnhandled, onHandled })`; `onUnhandled` records a non-fatal report and forwards
  the rejection to the previous global handler as non-fatal (LogBox in development, the native log in
  release). React Native's own development tracker, which this call replaces, also reports it as
  non-fatal, but differently: it wraps the value in `new Error('Uncaught (in promise, id: N): ...', {
  cause })` and calls `ExceptionsManager.handleException` directly (react-native 0.86.3,
  `Libraries/promiseRejectionTrackingOptions.js`). The net goes through the global handler instead, with
  the raw value, so a crash reporter chained there receives it too, which is why section 8 switches the
  reporter's own rejection tracking off.
- **The same in every build.** Nothing in the net module, the instance module or the installer tests
  `__DEV__` or `NODE_ENV`: the net exists for release builds, where nobody watches LogBox. A guard around
  the tracker, the install call, the handler or its call of the previous handler (`if (__DEV__)
  previous(error, isFatal)` stops fatal errors from crashing in release) is what `check-error-net` reports
  (`net-rejections`, `net-installed`, `net-chains`, and `net-every-build` for any other guard, such as a
  `const isTracking = __DEV__` flag).
- **Buffers until connected.** Reports made before the error log exists wait in a bounded buffer (50 by
  default, oldest dropped) and flush, synchronously and oldest first, when `connect(sink)` runs. A net
  nobody connects keeps every report in memory until the process ends, so the composition root connects
  it (section 5). A fatal error before `connect` still reaches the crash report through React Native's
  own handler.
- **Guards its sink.** A sink that throws is caught and logged with `console.error` (it reaches the native
  log in release). A throwing logger inside the global handler would re-enter the handler and recurse.
- **Idempotent and refresh-safe.** `install()` twice keeps one handler; a net re-created by fast refresh
  replaces the old net's handler instead of stacking a second one; `install()` returns the uninstall
  function tests use.
- **Tolerates missing hooks.** On web or a non-Hermes engine the missing hook is `null` and the net
  installs what exists.

`check-error-net` proves the shape: exactly one app file sets the global handler (`net-single`); the
function it installs calls the handler `getGlobalHandler()` returned, directly or through one alias such
as `current[CHAINED] ?? current` (`net-chains`; reading it without calling it is the bug that silences
LogBox and stops fatal crashes); it enables the tracker (`net-rejections`); no development-only guard
governs the tracker, the handler, the install call or anything else in the net's files (`net-rejections`,
`net-chains`, `net-installed`, `net-every-build`); every call of the connected sink sits inside a `try`
that has a `catch` (`net-guarded`; a `try` elsewhere in the file does not count); and some app file
connects the instance in every build (`net-connected`; a `.connect` on something else, such as a
websocket, does not count).

## 4. Installing it first

Imports are evaluated in order, depth first, **before** the importing module's own body. So
`appErrorNet.install();` written in the root layout's body runs after every module the layout imports has
loaded, and a module that throws while loading is not covered. The installer is therefore a side-effect
import, the first app import of the root layout:

```tsx
// src/app/_layout.tsx
import '@/services/error-net/install-error-net';   // first: polyfill imports may come before it

import { Stack } from 'expo-router';
...
```

`check-error-net` checks it (`net-installed`): the first import with bindings must come after a
side-effect import of a module that calls `install*()` at module scope and reaches the net.

Is the root layout early enough? In development Expo Router 57 validates the route tree starting at the
root node, so the root layout is the first app module evaluated; screens load later (read from
`expo-router/build/getRoutesCore.js`). For strictly-first, use the custom entry: i18n-strings-and-catalogs
already makes `"main": "index.ts"` to force the Intl polyfills first (Hermes lacks `Intl.PluralRules` and
`Intl.Locale`), so the installer goes right after them:

```ts
// index.ts
import '@/i18n/intl-polyfills'; // i18n-strings-and-catalogs: the forced Intl polyfills come first
import '@/services/error-net/install-error-net';
import 'expo-router/entry';
```

`check-error-net` accepts the installer in either place (the entry or the root layout); side-effect imports
such as the polyfills may come before it. app-startup-and-bootstrap owns the full startup order
(polyfills, net, config, storage, i18n, theme); the net is the first thing after the polyfills.

## 5. Connecting the error log

Until `connect(sink)` runs, every report waits in the net's buffer, and the buffer lives in the JS
context: a crash or a `reloadAppAsync` ends it. Three decisions follow.

**Connect in the composition root, before any provider renders.** The root layout's first statement
creates the services in a `useState` initializer (architecture-and-boundaries: one composition root,
called once), and the next line connects the error log (`examples/root-layout.tsx`,
`examples/connect-error-log.ts`):

```tsx
function startServices(): Services {
  const services = createDeviceServices();
  connectErrorLog(appErrorNet, services.errorLog); // the buffer flushes here, oldest first
  return services;
}

export default function RootLayout(): React.JSX.Element {
  const [services] = useState(startServices);       // runs once, before any provider below
  ...
}
```

A render error in any provider or screen below that line is recorded by the root boundary into a
connected log, which is the startup crash the root boundary exists for. Not at module scope:
architecture-and-boundaries forbids creating adapters at import time (a reload and Fast Refresh re-run
modules), and the net's own bounded buffer already covers that window. The only reports that can still be
lost are those made before or inside `createDeviceServices()` itself, which then live only in the buffer
and in React Native's native log (`ExceptionsManager` reported the caught render error as non-fatal).

**Make the log durable.** `services.errorLog` starts as the session's memory log (architecture-and-
boundaries' `createMemoryErrorLogAdapter`) and becomes the SQLite error log of persistence-and-migrations
once storage exists; that adapter writes synchronously and takes the memory log as its fallback. Connect
again when a better log appears: `connect` replaces the sink. A memory-only log is discarded by every
crash and reload, so an app that must keep startup crashes across a restart needs the persistent log
connected before the first screen.

**Synchronous, so nothing needs flushing before a reload.** The sink must be synchronous and must never
throw. Then the root boundary's `record` has committed its entry when the fallback mounted, before the
user can press Restart, and `reloadAppAsync('crash-recovery')` loses nothing that reached the log. Never
make the sink `async`: a fatal error ends the process right after the global handler returns, and a
reload does not wait for a pending promise.

The error log adapters themselves (newest N rows in SQLite, an export for support) belong to
architecture-and-boundaries and persistence-and-migrations; this skill only routes into them.
`check-error-net` fails when no app file other than the net calls `<instance>.connect(...)` or passes the
instance to a function (within two imports) that does (`net-connected`).

## 6. The root ErrorBoundary (Expo Router)

Read from `expo-router/build/views/Try.js` and `build/useScreens.js` (57.0.24):

- A route file (a layout included) that exports `ErrorBoundary` is wrapped in Expo Router's `Try`
  component: a class boundary with `getDerivedStateFromError` that renders
  `<ErrorBoundary error retry />`. `retry()` clears the error and re-renders the route.
- **`Try` has no `componentDidCatch`: it records nothing.** In a release build a caught render error is
  invisible unless the boundary you export records it. The template
  `createRouteErrorBoundary({ record, Fallback, restart })` records once, in an effect, when it mounts.
- `getDerivedStateFromError` also hides the splash screen, so the fallback is visible even when the crash
  happens during startup.
- A route without the export throws to the nearest parent's `ErrorBoundary`. Export it from the root
  layout: a render error that escapes every boundary goes to React's `onUncaughtError`, a fatal crash that
  bypasses `ErrorUtils` (section 1), so it unmounts the app and leaves no error-log entry.
- **The root boundary's `record` is the only place a render error is recorded.** React Native's
  `onCaughtError` reports the caught error to `ExceptionsManager` as non-fatal (LogBox, the native log),
  never to the net. So `record` must reach the error log (`appErrorNet.report({ source: 'render', ... })`),
  and a `record` that only writes to the console records nothing in release.
- The root export wraps the root layout itself, so the fallback renders **outside every provider that
  layout mounts** (theme, i18n, stores, query client). The fallback must read no context that lacks a
  default (`templates/src/features/crash-recovery/crash-fallback.tsx`):
  - **Theme:** `useTheme()` is safe. design-system-structure's theme context defaults to the app's light
    theme, the same theme `AppText` falls back to, so the example passes `theme.colors.background` to
    `CrashScreen` and text and background stay a pair whose contrast the theme proves. Never import
    `APP_THEMES` or the palette to build a "static" colour (design-system-structure's
    `no-palette-import`); the context default already is that colour.
  - **Copy:** `useT()` throws outside `I18nProvider`. The fallback calls i18n-strings-and-catalogs'
    `createTranslateNow(onError)` (`src/i18n/translate-now.ts`, in `src/i18n/` because only that folder
    imports react-intl): a t() built from the same pieces as `useT()` for the language and digits
    `I18nProvider` showed last (it records them after every commit, and the record outlives the crashed
    layout), or the device's languages when no provider committed yet. A missing message goes to
    `onError` (the example passes `appErrorNet.report`) and renders its key; it never throws.
  - **Direction:** outside `I18nProvider`, `AppText` falls back to the text-locale default (`en`, left to
    right), so Arabic crash copy would be laid out backwards with Latin line heights. The fallback wraps
    `CrashScreen` in `TextLocaleProvider` (`src/theme/text-locale.tsx`) with `languageNow()`'s language
    and `directionOf(language)` (`src/i18n/languages.ts`): the same language `createTranslateNow` used,
    so copy and direction always agree. It is a provider with a plain value, so it adds no context read.
    rtl-and-direction's `root-direction-provider` follows the root `Fallback` import and checks this.
  - **Press:** `CrashScreen` uses React Native's core `Button` on purpose: it renders outside every
    provider, so the crash fallback stays trivial. ui-component-library's `press-outside-host` accepts it
    through the `// press-outside-host: <why>` line above the import.
  - Expo Router's `ExpoRoot` mounts `SafeAreaProvider` above the root layout, so safe-area hooks still work.
- **Keep the fallback trivial, because nothing catches it.** A boundary does not catch errors in its own
  fallback; the error goes to `onUncaughtError` and crashes the app, and the template's `record` effect never
  runs because the fallback never committed. A fallback that reads a provider, parses data or calls a store
  turns a recoverable render error into an unrecorded crash. This, more than style, is why it reads no
  context and does almost nothing.
- To keep a navigator's header or tab bar on screen while one screen fails, a layout can set
  `unstable_settings.screenErrorBoundary` or pass `unstable_screenErrorBoundary` to its navigator (both
  unstable in 57; prefer a per-route `ErrorBoundary` export).

`check-error-net` checks the root export (`root-boundary`), that its implementation records and that the
`record:` option the root layout passes calls something besides `console.*` (`boundary-records`), and that
neither the boundary nor the `Fallback` the layout passes (followed through its import, with the components
that file imports) retries or navigates away from an effect or a timer (`no-auto-retry`).

## 7. Crash loops and the way out

A render error that happens on every render, retried automatically, is a crash loop: the screen flickers,
the log fills, the battery drains. The fallback offers **one way out, on a user action**:

- Root layout: `restart: () => reloadAppAsync('crash-recovery')` (from `expo`; it reloads the same
  bundle and works in release and debug builds, per its TSDoc). The reload re-runs startup and rehydrates
  from storage, which is safe because nothing the user saved lives only in memory.
- A nested route: `retry()` (the default) or navigating to a safe screen.
- Never call `retry`, `reset`, `onRestart` or a reload from `useEffect`, `setTimeout` or
  `requestAnimationFrame`, and never hand one to a timer (`setTimeout(onRestart, 3000)` is the same loop).
- Navigating away by itself is the same loop: `router.replace('/')` in a timer lands on a screen that may
  throw again, and the app bounces between it and the fallback. `router.replace/push/back/navigate/
  dismissAll` and `navigation.reset` belong in the button's handler too.
- An automatic retry cannot save a broken fallback either: an error inside the fallback is fatal and
  unrecorded (section 6). The user's one button, on a fallback that cannot throw, is the whole design.

## 8. Living with a crash reporter

When the app ships a crash reporter (crash-reporting-and-observability owns Sentry behind a
`CrashReporterPort`), read from `@sentry/react-native` 7.11.0 `integrations/reactnativeerrorhandlers.js`:

- Its `setupErrorUtilsGlobalHandler` chains the previous global handler, so with the net installed first
  both record a fatal error.
- Its `setupUnhandledRejectionsTracking` calls `HermesInternal.enablePromiseRejectionTracker(...)` with
  its own options and does not forward to anyone. Hermes keeps one set of tracker options (the promise
  library's `enable()` replaces the previous ones; read from source, confirm on a device), so whoever
  calls it last wins: after `Sentry.init`, the net no longer sees rejections.
- Default here: keep the net as the one tracker. Initialise Sentry with its rejection tracking off
  (`reactNativeErrorHandlersIntegration({ onunhandledrejection: false })`) and let the net's sink forward
  reports to the `CrashReporterPort`. crash-reporting-and-observability states the exact integration code.
- The sink it connects is `createCrashReportingSink({ errorLog, crashReporter })`
  (`src/services/crash-reporter/crash-sink.ts`, crash-reporting-and-observability): every report goes to
  the error log, and only `render` and `unhandled-rejection` are forwarded. `global-handler` is not,
  because Sentry's own global handler, chained after the net's, already captures it and flushes a
  fatal one first; both native SDKs then drop React Native's fatal JavaScript crash on the assumption
  that JavaScript reported it (iOS "Unhandled JS Exception", Android `JavascriptException`; read in
  `@sentry/react-native` 7.11.0 by crash-reporting-and-observability, not observed here). Forwarding
  `global-handler` as well would report every fatal error twice.

## 9. React Navigation, web, non-Hermes engines

- **React Navigation (fenced alternative):** wrap the `NavigationContainer` in one class boundary with
  `getDerivedStateFromError` and a `componentDidCatch` that records; `check-error-net` then looks for a
  `componentDidCatch` that records instead of the route export. Install the net from `index.ts`, the
  `registerRootComponent` entry, and connect the error log where `App` creates its services.
- **Web (react-native-web):** there is no `ErrorUtils` and no `HermesInternal`; the net's hooks are
  `null`. web-support ships the variant: `src/services/error-net/app-error-net.web.ts` builds this same
  `createErrorNet` from `window` `error` (through an `ErrorUtils`-shaped adapter) and
  `unhandledrejection`; `error-net.ts` is unchanged, and web-support's `web-error-net` rule fails a web
  bundle that installs the net with no `.web` sibling.
- **Non-Hermes engines:** `HermesInternal` is absent; the net installs the global handler only. The
  canonical stack runs Hermes.

## 10. Proving it on a device

Jest proves the wiring (the templates' tests use fake hooks, the real `ErrorUtils` of jest-expo, and
`renderRouterWithProviders` with a route that throws). A device proves the release behaviour. Use a
release build on a named, dedicated simulator or emulator (never "the booted one"; ios-simulator-build and
android-emulator-build create `<project>-<purpose>` devices), with a test-only trigger from
debug-menu-and-test-hooks that throws in a handler, rejects a promise, or throws in render:

```sh
xcrun simctl launch <udid> <bundle-id>                 # iOS: then trigger, relaunch, read the error log
adb -s <serial> shell am start -n <package>/.MainActivity
adb -s <serial> logcat -d -s ReactNativeJS ReactNative   # Android: the forwarded non-fatal lines
```

Pass criteria: the rejection is in the error log after relaunch (it was silent before the net), the
render error shows the crash screen and is in the log, and the handler error crashes and is in the log on
the next launch.

The startup case needs its own pass, because it is the one the root boundary exists for: make the root
layout itself throw in its first render, after `startServices` ran (a test-only flag read in the layout,
from debug-menu-and-test-hooks), see the crash screen, press Restart, and after the reload the entry is in
the persistent log. With a memory-only log the entry is gone after the reload: that is the signal to
connect the persistent log earlier (section 5). Jest proves the boundary half of it
(`create-route-error-boundary.test.tsx` renders a `_layout` that throws).
