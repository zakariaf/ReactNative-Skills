# Error flow, breadcrumbs and tracing

How an error travels from where it happens to one Sentry issue (never zero, never two), what
breadcrumbs may say, and how production performance tracing fits. Read from `@sentry/react-native`
7.11.0 (`integrations/reactnativeerrorhandlers.js`, `integrations/default.js`, `sdk.js`,
`ios/RNSentry.mm`, `android/.../RNSentryModuleImpl.java`) and `@sentry/core` 10.37.0
(`integration.js`) on 2026-10-14; the error net is error-handling-typed-results' template. Re-verify:
`npm ls @sentry/react-native @sentry/core` and read the same files.

## Contents

1. Who catches what
2. Why the net keeps rejections and Sentry keeps the global handler
3. The sink: exactly two sources
4. Defects versus expected failures
5. Breadcrumbs
6. Tracing and performance monitoring
7. Flushing before an OTA reload

## 1. Who catches what

| Error | Caught by | Reaches Sentry through | Local error log |
|---|---|---|---|
| Uncaught exception (fatal or not) | React Native's global handler, chained by the net, then by Sentry | Sentry's own `onerror` handler (level `fatal` for fatal ones, flushed before the app ends) | the net's handler, called by Sentry's after the flush |
| Unhandled promise rejection | Hermes' rejection tracker, owned by the net | the sink (`unhandled-rejection`) | the sink |
| Render error | Expo Router's `ErrorBoundary` (the root layout's `createRouteErrorBoundary`) | the sink (`render`) | the sink |
| Native crash (Swift/ObjC, Java/Kotlin, NDK), app hang, watchdog termination | the native SDK | the native SDK, on the next launch | — |
| Expected failure (`Result` error) | the code that handles it | never (it is not a defect) | the boundary that records it |

## 2. Why the net keeps rejections and Sentry keeps the global handler

**Rejections.** `reactNativeErrorHandlersIntegration` (a default integration) calls
`HermesInternal.enablePromiseRejectionTracker(...)` with its own callbacks. Hermes keeps one set of
tracker options, so whoever calls it last wins: after `Sentry.init` the error net would never see a
rejection again, and the local error log would miss them. The adapter therefore passes
`integrations: [Sentry.reactNativeErrorHandlersIntegration({ onunhandledrejection: false })]`. In
`@sentry/core`, a user integration replaces the default one with the same name (`filterDuplicates`:
a default instance never overwrites a user instance), so this is the only error-handlers integration
installed (`rejection-tracker`). The net keeps tracking in every build and forwards through the sink.

**The global handler.** Sentry's `setupErrorUtilsGlobalHandler` reads the current handler (the net's,
installed first by the root layout's first import) and installs its own in front: for a fatal error
in a release build it captures the event, waits for `client.flush(shutdownTimeout)` (2 s default),
then calls the previous handler, so the net still records and React Native still ends the app.
Keeping Sentry's handler matters twice over: the flush gets the fatal event out before the process
dies, and both native SDKs **drop** React Native's own fatal-JS crash on purpose (iOS ignores events
whose exception type contains "Unhandled JS Exception", Android ignores `JavascriptException`), on the
assumption that JavaScript reported it. Turning `onerror` off would lose fatal JavaScript crashes.

Order does not matter for correctness: whichever way round, Sentry chains the net and the net chains
React Native. It does matter for coverage: anything thrown before `Sentry.init` (startup, before the
consent is applied) reaches the local error log only.

## 3. The forwarder: exactly two sources

The canonical root skeleton connects its own sink in `startApp` (app-startup-and-bootstrap's
`createKitErrorSink`): it records every report in the error log first, then hands it to each root kit's
`forward` slot. The crash reporting kit fills that slot, and the root files stay unchanged:

```ts
// src/services/crash-reporter/crash-reporting-root-kit.tsx
forward: createCrashForwarder(input.crashReporter),
```

The forwarder sends `FORWARDED_SOURCES` = `['render', 'unhandled-rejection']` to
`crashReporter.captureException(error, { source, isFatal })`. Forwarding `global-handler` too would
send every uncaught exception twice (once from Sentry's own handler, once from the forwarder);
forwarding neither of the others would lose render errors and rejections. `sink-forwarding` holds the
constant to exactly those two, `sink-connected` proves a kit forwards and the registry creates it. The
net's buffer (50 reports before the sink connects) flushes into the sink on connect; the sink keeps
what it received until the kits exist a few statements later and replays it to them, and the adapter
queues reports until the consent is applied.

The adapter tags each event with `source` (filter issues by boundary in Sentry) and sets the level
from `isFatal`.

**Queued items carry the consent time.** A report or breadcrumb that waited in the adapter's queue
(before the choice was applied) is handed to the SDK only when consent arrives, so its event or
breadcrumb timestamp is the moment of `setConsent(true)`, not the moment of the error; the order is
kept. The window is short (the first screen), so the skew is seconds; reading an issue whose time
matches an app launch, treat it as "during startup". Stamping the original time would need the
adapter to read the clock (a ClockPort parameter) for every item; it is not worth that for a window
this small.

## 4. Defects versus expected failures

`captureException` is for defects: something the code did not expect. An expected failure (offline,
a 404 the screen handles, a validation error) is a `Result` value and goes to the error log at most
(error-handling-typed-results). Reporting expected failures floods the project, hides real crashes
and burns the event quota. A handled-but-unexpected case (a migration that should never fail, a
parse of the app's own data) may call `services.crashReporter.captureException(error, { source:
'storage', isFatal: false })` from the code that handles it, after recording it with
`errorLog.record('storage', error)`: the reporter sits behind architecture-and-boundaries' error log,
so every report is in the local log too (`capture-recorded` fails a report without the record
before it).

## 5. Breadcrumbs

Breadcrumbs are the steps before a crash. The port's `addBreadcrumb({ category, message, data })`
sends them as `app.<category>`; the scrubber keeps `app.*`, `navigation`, network categories and
`sentry.*`, and drops console, touch and UI crumbs.

| Category | Message | Example |
|---|---|---|
| `navigation` | the route pattern from `useSegments()` | `(app)/tasks/[id]` |
| `lifecycle` | a fixed event name | `foreground`, `background`, `update-applied` |
| `action` | a fixed event name | `task.completed`, `list.reordered` |
| `storage` | what happened, no values | `migration.v3.applied` |
| `network` | method and route template, never a URL with values | `GET /tasks/:id 503` |

Rules: a message is never text the person typed or a value from their data; `data` holds flat
primitives that are not content (counts, durations, flags; not ids of their rows). Route breadcrumbs
come from `useSegments()`, never `usePathname()` or the search params (`route-breadcrumbs`):
`/tasks/42?q=doctor` is content, `tasks/[id]` is diagnosis. `useRouteBreadcrumbs(crashReporter)` is
called once, by the kit's effects, which the root skeleton mounts beside the root Stack (inside the
navigator, so `useSegments()` knows the route). React Navigation's `reactNavigationIntegration` is not used: it needs
the navigation container ref in the canonical root layout and records route names with params.

The SDK's own fetch/XHR breadcrumbs (`xhr` category; fetch crumbs are off on mobile in 7.11) keep their
URL without the query after scrubbing (and `http.query`/`http.fragment` in their data redacted). iOS also records `NSURLSession` breadcrumbs natively, outside
the scrubber: the server-side scrubbing settings cover those.

## 6. Tracing and performance monitoring

Off by default: `TRACES_SAMPLE_RATE = 0` in `src/config/crash-reporting-config.ts`, and the adapter
adds `tracesSampleRate` (and `profilesSampleRate`, capped at the traces rate) only when it is above 0.
Turning it on is a product decision with the reviewer:

- set `TRACES_SAMPLE_RATE` to at most the contract's `maxTracesSampleRate` (default cap 0.2;
  `trace-rate`; a `tracesSampler` function is refused because its rate cannot be reviewed);
- keep `performance-data` in `declarations.collects` (the template declares it already, because the
  Sentry pod's own manifest does; `declaration` fails a rate above 0 without it);
- it follows the same consent: tracing starts only with the SDK;
- `beforeSendTransaction` stays set to `scrubEvent` (`scrub-hooks` requires it whatever the rate):
  transactions carry span descriptions and span data with full request URLs (`GET
  https://api.example.test/tasks?owner=...`) and the bare query and fragment under `http.query` and
  `http.fragment`; the scrubber strips URL queries, redacts those two keys and masks the texts of
  every span's `description` and `data` (privacy reference, section 3).

What tracing adds with the defaults of 7.11 (`integrations/default.js`): app start spans, slow and
frozen frames, JS event-loop stalls, and with `reactNativeTracingIntegration` navigation spans. The
app-start end is the root component's creation, which only `Sentry.wrap` records; without it the SDK
ends the span at the bundle start and warns (read from `tracing/integrations/appStart.js`), so its
app-start numbers undercount in this library's setup (no wrap, rule `no-wrap`). Use frames, stalls and
navigation spans from Sentry, and app start from performance-budgets, which owns the budgets and the
measurements. When comparing numbers: App Store Connect Organizer and MetricKit stop at the first
frame, and performance-budgets' `totalMs` stops at the first screen drawn with data, so no two of
these measure the same interval.

## 7. Flushing before an OTA reload

`Updates.reloadAsync()` replaces the JavaScript runtime. Events still in the SDK's queue are lost
unless they were written out first: the update flow calls `await services.crashReporter.flush()`
before reloading (ota-updates owns that flow and its restart path; `flush` resolves `false` when
reporting is off and never rejects). The crash screen's `reloadAppAsync` needs no flush: a render
error reaches the reporter through the sink as soon as it is caught, and `captureException` hands the
event to the native SDK, which writes the envelope to disk long before the person reads the screen
and presses Restart; a queued envelope is sent at the next start. An app that wants the extra margin
may `await crashReporter.flush()` in that button's handler too.
