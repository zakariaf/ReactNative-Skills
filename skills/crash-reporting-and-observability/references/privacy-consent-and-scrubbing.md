# Privacy, consent and scrubbing

What a crash report may contain, who decides whether one is sent, and how the store declarations stay
true. Facts about the SDK were read from `@sentry/react-native` 7.11.0 on 2026-10-14 (re-verify:
`npm ls @sentry/react-native`, then read `dist/js/options.d.ts`, `dist/js/integrations/default.js` and
`ios/RNSentry.mm`); legal points are the library's defaults, not legal advice, and the developer
confirms them with whoever owns the privacy policy.

## Contents

1. What a report contains by default
2. The privacy-first option set
3. Scrubbing: what the scrubber does and cannot do
4. No identity, ever
5. Server-side scrubbing (a human step)
6. Consent: the two models and the default
7. Where the choice lives and when it is applied
8. Store declarations and the privacy manifest
9. Children's apps

## 1. What a report contains by default

| Part | Source | Personal? |
|---|---|---|
| Exception type, message, stack frames | the error | the message may hold user input ("cannot save ana@...") |
| Breadcrumbs | console calls, fetch/XHR URLs and status, touches (with `Sentry.wrap`), navigation | console arguments, URL queries and touched labels often hold content |
| Device and OS context | native SDK | model and OS: no; the device name only with `sendDefaultPii` |
| App context | native SDK | bundle id, version, build, start time: no |
| OTA context (`ota_updates`) | `expoContextIntegration` (automatic in Expo builds) | update id, channel, runtime version: no |
| User | whatever `setUser` set; IP address inferred by the server when `sendDefaultPii` is on | yes |
| Screenshot, view hierarchy, Session Replay | only when turned on | yes: whatever was on screen |
| Request data (cookies, headers, body) | browser integrations and failed-request capture | yes |

Native SDKs may also attach an anonymous installation identifier to native events (used for
crash-free user counts); it identifies an install, not a person. Stated from Sentry's documentation,
not verified in a build.

## 2. The privacy-first option set

`sentryOptions()` in the adapter template writes, and `check-crash-reporting` holds it to:

| Option | Value | Rule | Why |
|---|---|---|---|
| `sendDefaultPii` | `false`, written | `pii-default` | the default is false, but Sentry's own Expo snippet sets it to true; writing it makes the choice reviewable |
| `attachScreenshot`, `attachViewHierarchy` | `false` | `screen-capture` | both capture what the person sees |
| `replaysSessionSampleRate`, `replaysOnErrorSampleRate`, `mobileReplayIntegration` | absent | `screen-capture` | Session Replay records the screen |
| `enableLogs` | absent or false | `screen-capture` | console output becomes Sentry logs |
| `enableCaptureFailedRequests` | `false` | `screen-capture` | sends failed request URLs (and on iOS HTTP error details) |
| `FeedbackWidget`, `FeedbackButton`, `feedbackIntegration` | absent | `screen-capture` | free text and optional screenshots; support goes through the app's own flow |
| `beforeSend`, `beforeSendTransaction`, `beforeBreadcrumb` | the scrubber | `scrub-hooks` | the last filter before anything leaves |
| `maxBreadcrumbs` | 50 | — | enough steps to see the path; fewer old crumbs to leak |
| `Sentry.wrap`, `TouchEventBoundary` | not used | `no-wrap` | touch breadcrumbs carry the label of what was pressed (a task title, a contact name) |

## 3. Scrubbing: what the scrubber does and cannot do

`crash-scrubber.ts` is pure and tested. On every JavaScript event (errors through `beforeSend`,
transactions through `beforeSendTransaction`) it:

- drops `user` entirely, and keeps only the query-less URL of `request` (no cookies, headers, body or
  query string);
- applies the **full text mask** (`scrubText`) to the message, the transaction name, every exception
  value, every string anywhere in `extra`, `tags`, breadcrumb `message` and `data`, transaction span
  `description` and `data`, and every context that is not an SDK context (below). The full mask
  removes URL queries and fragments and masks e-mail addresses, bearer tokens, JWTs, and standalone
  digit runs with nine or more digits (phone, card and account numbers; ISO dates and versions have
  fewer and stay readable);
- applies **every mask except the digit-run one** (`maskSecrets`) to the SDK contexts listed in
  `SDK_CONTEXTS` (`app`, `device`, `os`, `culture`, `runtime`, `trace`, `ota_updates`,
  `react_native_context`): they hold identifiers and device facts, and a digit mask would corrupt
  `contexts.trace.trace_id` or `contexts.ota_updates.update_id` (which section 5 of the releases
  reference filters on);
- redacts the value of any key matching `SENSITIVE_KEY` (password, secret, token, auth, cookie,
  session, e-mail, phone, address, card, IBAN, SSN, birth) anywhere in `extra`, `contexts` (a whole
  context whose name matches too), `tags`, breadcrumb `data` and span `data`, walking at most
  `MAX_DEPTH` levels (a cyclic value cannot hang it);
- redacts the value of `http.query` and `http.fragment` (`QUERY_KEY`) wherever it walks: Sentry's
  fetch and XHR request spans (and their breadcrumbs) carry the bare query string (`?q=doctor&key=…`)
  and fragment under these keys when tracing is on, with no URL in front for the URL mask to find;
- keeps only breadcrumbs of the categories `navigation`, `xhr`, `fetch`, `http`, `app.*` (the port's
  own) and `sentry.*`; `console`, `touch` and `ui.*` crumbs are dropped.

Limits of the digit mask, on purpose: a run glued to a letter, digit, underscore or hyphen on either
side (`4bf92f3577123456789...`, a UUID group, `user-123456789`) is part of an identifier and is not
masked, and a UUID whose groups happen to be all digits is kept whole. A number the app glues to a
word that way is therefore not caught: keep personal numbers out of texts and ids, and under a
sensitive key where they must travel. A standalone epoch timestamp (10 digits in seconds, 13 in
milliseconds: `Timestamp 1760400000000`) is a long digit run too and is masked; log ISO dates
(`2026-10-14T09:30:00Z`), which stay readable. The key list redacts some harmless span keys too
(`server.address`); that loses a host name, never a secret.

What it **cannot** reach: a native crash. The native SDK writes it at the moment of the crash and
sends it on the next launch, outside JavaScript, so `beforeSend` never sees it. A native crash report
carries the native stack, device and app context, native breadcrumbs (iOS records `NSURLSession`
requests by default) and the **scope** JavaScript synced to native: tags, contexts, user and
breadcrumbs added through the SDK are mirrored to the native scope (`enableSyncToNative` in
`sdk.js`). Breadcrumbs pass `beforeBreadcrumb` before they reach the scope, so they arrive scrubbed;
a `setUser`, `setTag` or `setContext` with personal data would not. Hence rule 4 below, and the
server-side settings in section 5 for native breadcrumbs.

Extending it: add a pattern to `scrubText` or a word to `SENSITIVE_KEY` with a test case beside the
existing ones. Never weaken a test to let a value through.

## 4. No identity, ever

The port has no `setUser`, and `no-user-identity` fails any `setUser(...)` other than
`setUser(null)`. Reasons: the scope syncs to native crash reports beyond the scrubber; a report linked
to an account changes the store declarations (data "linked to the user") and the legal basis; and a
crash is diagnosed from the stack and the steps, not from who had it. Support that needs to find one
person's crash uses the event id: `Sentry.lastEventId()` is SDK API, so if the app wants it, add a
port member `lastReportId(): string | null` and show it on the support screen for the person to copy.

## 5. Server-side scrubbing (a human step)

The developer turns these on in the Sentry project (Settings, Security and Privacy) before the first
build that reports, and says so in the report:

- **Data Scrubber** and **Use Default Scrubbers**: on.
- **Prevent Storing of IP Addresses**: on.
- **Additional Sensitive Fields**: the app's own field names (`title`, `note`, `body` for a Tasks
  app).
- **Scrape JavaScript source context**: on only when the source maps are uploaded (they are).

These cover native events and anything the client missed. Do not log in to the developer's Sentry
account or change settings for them: hand over the list and wait for confirmation.

## 6. Consent: the two models and the default

`contracts/crash-reporting.json` `consentModel`:

| Model | First-launch value of the saved choice | When to use |
|---|---|---|
| `opt-in` (template default) | `false`: nothing is sent until the person turns crash reports on (onboarding, settings) | the conservative default; required where the privacy policy or the audience calls for consent (EEA/UK audiences under ePrivacy rules, children) |
| `opt-out` | `true`: reports are sent until the person turns them off in settings | where the privacy policy documents crash reporting as necessary for operating the app and the developer has decided so |

Either way the settings screen shows a "Send crash reports" toggle that always works. Turning it off
takes effect immediately (the hook re-applies the choice and the adapter closes the SDK); turning it
back on after that applies at the next launch, because a closed SDK stays closed for the run (section
7). Turning it on when it was never on starts reporting at once. The row's hint says so: "Turning
this back on applies the next time you open the app."
`consent-default` fails a settings default that contradicts the model. Crash-report consent is its own
choice: it is not the ads consent (admob-ads-and-consent's UMP answer) and not analytics consent
(analytics-and-consent); combining them would let one answer stand in for another purpose.

How this fits the app's other consent (the library's one contract, recorded in the repository's
decisions): admob-ads-and-consent's `src/services/consent/*` (`ConsentPort`: Google's UMP and Apple's
App Tracking Transparency) is the app's one consent-platform port, and no other skill builds a second
UMP or ATT store. Crash reporting reads nothing from it: reports are not tracking (no ATT), and UMP's
`canRequestAds` answers for ads only (true without any question outside regulated regions, false in
every ads-off build), so it cannot stand for this choice. The crash-report choice itself is stored
exactly once, as the settings field below: no kv key, flag file or Sentry-side switch beside it. A
consent screen may show the crash toggle next to the usage-data and ad-privacy entries; each still
saves and applies its own answer.

## 7. Where the choice lives and when it is applied

- **Storage:** a settings field `crashReportsEnabled: v.boolean()` added the way settings-and-preferences
  adds every field (schema, default from the model, `contracts/settings.json`, reducer case, a row in
  the settings screen). `examples/settings-schema.ts` shows the field.
- **Timing:** `useCrashReportingConsent(crashReporter, { isReady, isGranted })` after the startup gate
  released the splash: the crash reporting kit's effects call it, and the root skeleton mounts them
  beside the root Stack only once the splash is gone (so `isReady` is `true` there). The kit reads
  `isGranted` from its consent source: a source over the settings store
  (`examples/create-root-kits.ts`' `settingsCrashConsent`, which follows every change of the row), or
  `fixedCrashConsent(false)` while the app has no settings row (never `fixedCrashConsent(true)`:
  `consent-applied`). The registry, the composition root and the root layout never call `setConsent`
  (`consent-applied`): that would start the SDK, and its connection, during startup
  (app-startup-and-bootstrap's deferred-work table puts the crash reporter after the first frame).
- **Before the choice:** reports and breadcrumbs that come through the port (render errors and
  unhandled rejections from the kit's forwarder, app breadcrumbs) wait in the adapter's queue (at most
  30, oldest dropped). On `true` they are sent, on `false` dropped. Three kinds of failure in this
  window never reach Sentry, not even later:
  - **fatal JavaScript errors**: Sentry's global handler is installed by `Sentry.init`; the error
    net records them in the local error log;
  - **non-fatal global-handler errors**: the forwarder never forwards the `global-handler` source (Sentry
    owns it once started), so nothing queues them; they too stay in the local error log;
  - **native crashes and app hangs**: the native SDK is not started, so no crash handler or hang
    watchdog runs.

  The platforms' own reports still count all three: App Store Connect Organizer and MetricKit on
  iOS, Android vitals in Play Console on Android.
- **Turning it off:** `Sentry.close()` and the adapter stays off for the rest of the run (closing the
  native SDK is asynchronous, so a re-init right after could be shut down too); the saved choice
  applies again at the next launch.
- **EAS Observe (`expo-observe`), when the app ships it:** it dispatches startup metrics, logs and the
  EAS client id from every release build by default (`dispatchingEnabled` defaults to true; SDK 57
  docs, read 2026-10-14 by analytics-and-consent). It is diagnostics, so it follows this same choice:
  call `Observe.configure({ dispatchingEnabled: false })` at module scope of its adapter (before any
  screen), and turn dispatching on from the component that calls `useCrashReportingConsent`, with the
  same `isReady && isGranted`. Declare it in `contracts/privacy.json` (privacy-and-store-declarations
  lists it as a network SDK); analytics-and-consent's `sdk-inventory` fails it while no code writes
  `dispatchingEnabled: false`. `expo-app-metrics` only measures on the device and sends nothing.

## 8. Store declarations and the privacy manifest

The contract's `declarations` are the facts privacy-and-store-declarations turns into answers; keep
them true (`contract`, `declaration`):

| Store | Answer for the default set (`crash-data`, `other-diagnostic-data`, `performance-data`: the data-type ids of privacy-and-store-declarations) |
|---|---|
| App Store Connect, App Privacy | Diagnostics: Crash Data, Performance Data, Other Diagnostic Data; not linked to the user; not used for tracking; purpose App Functionality |
| Google Play, Data safety | App info and performance: Crash logs, Diagnostics; collected, not shared (Sentry processes them as a service provider); optional when the person can turn reports off; encrypted in transit. Apple's Performance Data and Other Diagnostic Data are both Play's Diagnostics (privacy-and-store-declarations' mapping) |

Performance Data is declared even with tracing off: the Sentry Cocoa pod's own `PrivacyInfo.xcprivacy`
(8.58.0, read 2026-10-14) lists crash data, performance data and other diagnostic data, Apple's
privacy report merges it into the app's, and privacy-and-store-declarations' `audit-privacy-manifest.mjs`
fails `undeclared-collection` for any pod type the contract leaves out. Release-health sessions (app
start, crash-free rate) are sent without tracing too.

iOS privacy manifest: the Sentry Cocoa pod ships its own `PrivacyInfo.xcprivacy`, but Sentry's
guidance for statically linked libraries (how Expo links pods by default) is that the app declares the
entries itself (Sentry's Apple privacy-manifest page, read 2026-10-14). privacy-and-store-declarations
owns the manifest, and its wiring is the one to use:

- the required-reason APIs Sentry uses (`NSPrivacyAccessedAPICategoryUserDefaults` CA92.1,
  `NSPrivacyAccessedAPICategorySystemBootTime` 35F9.1, `NSPrivacyAccessedAPICategoryFileTimestamp`
  C617.1) are already in its `src/config/privacy-manifest.ts` (`PRIVACY_MANIFESTS`, from React Native),
  so nothing is added there;
- the collected data types go beside the spread, never instead of it:
  `privacyManifests: { ...PRIVACY_MANIFESTS, NSPrivacyCollectedDataTypes: [...analytics types, ...Sentry types] }`
  (crash data, performance data and other diagnostic data, not linked, not tracking, App
  Functionality); its `privacy-manifest` rule accepts that form;
- `contracts/privacy.json` declares `@sentry/react-native` in `sdks` with `pods: ["Sentry"]`,
  `maven: ["io.sentry:"]` and those collected rows: the declaration covers its ingest host (a network
  SDK, outside the `ApiClient` port by nature) in the bundle and native audits, and `audit-privacy-manifest.mjs`
  fails `undeclared-collection` without it. `contracts/crash-reporting.json` `declarations` is the
  source and the privacy contract's rows are the copy: check-crash-reporting `privacy-sync` keeps the
  types equal (both use privacy-and-store-declarations' ids: `crash-data`, `other-diagnostic-data`,
  `performance-data`).

## 9. Children's apps

An app in Apple's Kids Category or Google Play's Families program may not send personal data to
third parties, and both stores scrutinise third-party SDKs. Crash reporting without identity can be
acceptable, but the developer decides with the store's current rules: use `opt-in`, keep every option
in section 2, and ask before shipping the SDK in such an app.
