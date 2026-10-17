# Vendors: the PostHog default, its options, and other SDKs

## Contents

- Why PostHog is the default
- Install
- The adapter's options, one by one
- Pitfalls verified in the source
- Wiring the vendor into the repo's rules
- Other vendors (fenced)
- Re-verify on upgrade

## Why PostHog is the default

The stack table names no analytics vendor, so this skill picks one default and keeps every rule
vendor-neutral behind `AnalyticsSdk` (five calls: `optIn`, `capture`, `flush`, `optOut`, `reset`).
posthog-react-native is the default because it:

- is plain JavaScript (no native module, no config plugin, works in Expo Go and every dev build);
- can be constructed opted out and opted in later, resets its identity, and has an anonymous mode
  (`personProfiles: 'never'`);
- offers EU and US hosting, chosen by `host` (the region is a declaration: `endpoints`);
- is open source (MIT), so every behaviour below was read in its source.

Any vendor works the same way: write `<vendor>-analytics-adapter.ts` that maps the five calls, put
its facts in assets/analytics-facts.json (`sdks.<package>`), and set `contracts/analytics.json` `sdk`.

## Install

```sh
npm install -E posthog-react-native@4.79.1
```

posthog-react-native is outside the Expo SDK 57 module map, so it is pinned exactly with npm (not
`npx expo install`), and the repo's dependency policy (dependency-management) records it. 4.79.1 was
the newest release at least 7 days old on 2026-10-14 (the `min-release-age=7` policy; PostHog
releases several times a week). Its peer dependencies are all optional. The app installs
`expo-application` anyway (`npx expo install expo-application`): `readAnalyticsExtra` needs the
binary's application id. With it present, PostHog attaches `$app_build`, `$app_name`,
`$app_namespace` and `$app_version` to every event by itself; they describe the build, not the user,
and need no extra declaration (they ride on the declared `product-interaction`). `expo-device` and
`expo-localization` add device and locale properties: install only what the declarations cover.
`expo-file-system` or async-storage are not needed because the adapter gives it `customStorage` on
`expo-sqlite/kv-store`, where it keeps its state under `.posthog-rn.json` (ids and unsent queue) and
`.posthog-rn-logs.json`; the adapter's `clearPosthogStorage()` deletes both (consent-gate.md, "No SDK
in this session"). The `posthog-react-native/expo` config plugin uploads
source maps for PostHog's error tracking: not used (crash reporting is its own port).

## The adapter's options, one by one

`examples/posthog-analytics-adapter.ts`; defaults read in 4.79.1 / @posthog/core 1.59.0 types.

| Option | Set to | Default | Why |
|---|---|---|---|
| `host` | `ANALYTICS_HOST` (an `endpoints` origin) | `https://us.i.posthog.com` | the region is a declaration, chosen on purpose |
| `defaultOptIn` | `false` | `true` | a cleared opt-out (after `reset`) means out |
| `personProfiles` | `'never'` (anonymous) or `'identified_only'` (`identifies: true`) | `'identified_only'` | `identify()` becomes a no-op in anonymous apps |
| `disableGeoip` | `true` | `false` | no IP-derived location, so no `coarse-location` to declare (the server still receives the IP: see "Discard client IP data" below) |
| `captureAppLifecycleEvents` | `false` | `true` | only catalog events leave the device |
| `disableSurveys` | `true` | `false` | surveys are UI the app did not design |
| `disableRemoteFeatureFlags` | `true` | `false` | no flag request ever: `reset()` reloads flags unless this is set (`preloadFeatureFlags: false` only skips the first load), and flags are not analytics |
| `errorTracking` | `{ autocapture: false }` | autocapture per local config | a second global error handler would replace the error net's (error-handling-typed-results) and duplicate crash reporting |
| `enableSessionReplay` | `false` | `false` | screen recording collects what the user typed and saw; banned |
| `customStorage` | kv-store `getItemSync` / `setItemSync` | async-storage or expo-file-system | async-storage is not part of this stack |

The adapter's `reset` is `client.reset([])` followed by
`client.setPersistedProperty(PostHogPersistedProperty.Queue, null)`: the empty list keeps nothing the
React Native client would keep by default (the device id), and the second call drops the unsent
queue (pitfalls 2, 3 and 8).

**The IP address is a project setting, not an option.** `disableGeoip: true` only stops PostHog
deriving a location. The ingestion server still records the client IP as the `$ip` property of every
event unless the project's **"Discard client IP data"** setting is on (PostHog project settings). An
IP address is personal data, and the default declarations assume none is kept. This is a
vendor-console step the agent cannot do: tell the developer to turn it on before the first live
build, or to declare and justify keeping IPs (store-declarations.md) and say so in the privacy policy.

check-analytics `sdk-options` requires `defaultOptIn: false`, `captureAppLifecycleEvents: false`,
`errorTracking: { autocapture: false }`, a `host`, `disableRemoteFeatureFlags: true`, `.reset([])`, the
queue clear, and (anonymous contracts) `personProfiles: 'never'`;
it fails `enableSessionReplay: true`, `captureTouches: true`, `captureScreens: true` and any use of
`PostHogProvider`.

## Pitfalls verified in the source

All read on 2026-10-14 in posthog-react-native 4.79.1 (`dist/posthog-rn.js`) and @posthog/core
1.59.0 (`dist/posthog-core.js`, `dist/posthog-core-stateless.js`):

1. **The constructor contacts PostHog.** It calls `reloadRemoteConfigAsync()`, guarded only by
   `disabled`; the opt-out state does not stop it. Fix: construct only after consent (the gate's
   `createSdk`).
2. **`reset()` clears the saved opt-out and keeps the queue.** The core `reset(propertiesToKeep)`
   writes null to every persisted property except `Queue`, `AiQueue`, `AiCaptureQueue`, `LogsQueue`
   and the list it is given. With `defaultOptIn: true`, an `optOut()` followed by `reset()` is opted
   in again. Fix: `reset()` then `optOut()`, and `defaultOptIn: false`.
3. **The React Native `reset()` keeps the device id.** Called with no argument, its override keeps
   `InstalledAppBuild`, `InstalledAppVersion` and `DeviceId` (its comment: once set, the device id
   survives `identify()` and `reset()`), and always keeps `RemoteConfig`, `SessionReplay`, `Surveys`
   and `PushRegistered` (project settings, not user data). So a no would keep the stable id that the
   next yes sends again. Fix: `client.reset([])`, which also drops `DeviceId`.
4. **`reset()` reloads feature flags over the network.** Unless `disableRemoteFeatureFlags` is set,
   the core reset calls `reloadFeatureFlags()`, a `/flags` request carrying `$anon_distinct_id` and
   `$device_id`. `flagsAsync` checks `disabled` and `disableRemoteFeatureFlags`, never the opt-out,
   and `preloadFeatureFlags: false` only skips the load at start. Fix: `disableRemoteFeatureFlags:
   true`; then reset just empties the cached flags.
5. **`optOut()` is a persisted flag.** A new client on the next launch reads it, so a later yes must
   call `optIn()` (the gate does, on every start).
6. **`PostHogProvider` constructs the client during render and autocaptures** (touch autocapture
   records `accessibilityLabel` and children text by default, `propsToCapture`). Never use it; the
   adapter constructs the client itself.
7. **Automatic screen capture does not work with Expo Router** (its own comment says to capture
   screens manually) and would send params. Use `useScreenViews`.
8. **A flush ignores the opt-out.** `optOut()` only stops new captures; `_flush()` sends whatever
   the queue holds, and the flush timer armed by the last capture (`flushInterval`, 10 s by default)
   still fires. With the queue kept by `reset()`, events captured just before a no would leave
   within seconds. Fix: clear the queue in the adapter's `reset`
   (`setPersistedProperty(PostHogPersistedProperty.Queue, null)`; both are public in 4.79.1). A
   batch already on the wire cannot be recalled; it was captured under the earlier yes.
9. **Logs** (`captureLog`, `logger`) ship whenever the SDK is initialised and the user is not opted
   out. The adapter never calls them.
10. **The native plugin and the replay package collect outside the catalog.**
   `@posthog/react-native-plugin` (optional peer) drives native session replay, native and NDK crash
   autocapture and rage clicks; `posthog-react-native-session-replay` records the screen. Neither is
   installed, so none of it is collected; check-analytics `sdk-inventory` fails either package in
   `package.json` (kinds `native-capture` and `session-replay` in assets/analytics-facts.json).

## Wiring the vendor into the repo's rules

- **architecture-and-boundaries**: `posthog-react-native` matches its SDK package patterns, so
  classify it in `contracts/architecture.json` as `"vendorSdks": { "posthog-react-native":
  "AnalyticsPort" }` (its `unclassified-sdk` rule fails until then; verified on a copy of the reference
  app on 2026-10-14). The adapter file name `*-analytics-adapter.ts` sits in
  `src/services/analytics/`, which its adapter globs already allow.
- **typescript-and-lint-rules**: add `vendor('posthog-react-native', 'AnalyticsPort')` to
  `VENDOR_SDK_PATHS` in `eslint.config.mjs` in the same commit; check-analytics `sdk-import` keeps the
  SDK inside the adapter either way.
- **dependency-management**: record the exact pin in `contracts/dependency-policy.json`.
- **privacy-and-store-declarations**: the network audit allows the `endpoints` origins; the SDK
  inventory lists the vendor.

## Other vendors (fenced)

Only the import, inventory and declaration rules know these; their option facts are not verified for
this skill (assets/analytics-facts.json says so per entry). Before adopting one, read its source or
docs for the same four questions: does construction send anything, how does opt-out persist, what
does reset keep, which data does it add by itself.

- **React Native Firebase Analytics** (`@react-native-firebase/analytics`): the native SDK starts at
  launch. `firebase.json` must set `"analytics_auto_collection_enabled": false` and
  `"google_analytics_adid_collection_enabled": false` (check-analytics `sdk-options` reads them); the
  adapter's `optIn` calls `setAnalyticsCollectionEnabled(true)`. It needs a config plugin and
  `GoogleService-Info.plist` / `google-services.json` (expo-prebuild-and-config-plugins). Firebase
  ships native privacy manifests; keep the app's own entries for anything its manifest misses.
- **Amplitude, Mixpanel, Segment, Aptabase**: JavaScript SDKs with an opt-out; map the five calls and
  add their facts.
- **Attribution SDKs** (AppsFlyer, Adjust, Branch): the tracking profile (att-and-tracking.md).
- **Session replay SDKs** (Microsoft Clarity, `posthog-react-native-session-replay`, PostHog's native
  plugin `@posthog/react-native-plugin`): banned (`sdk-inventory` on the package, `sdk-options` on
  `enableSessionReplay: true`).
- **expo-insights**: sends an event on every cold start automatically (Expo docs, EAS Insights > App
  usage, read 2026-10-14), so it cannot wait for consent; check-analytics `sdk-inventory` fails it.
  EAS Update's own request metrics need no SDK.
- **expo-observe** (EAS Observe, performance telemetry): release builds dispatch startup metrics,
  logs and the installation's EAS client id by default (`dispatchingEnabled` defaults to `true`;
  Expo SDK 57 docs, Observe API and EAS Observe > Configure, read 2026-10-14). It is not product
  analytics, and crash-reporting-and-observability owns its consent decision. check-analytics
  `sdk-inventory` fails it unless the app's code writes `dispatchingEnabled: false` (the start state
  before consent); an app whose only analytics fact is expo-observe gets just that one rule.
- **expo-app-metrics**: collects startup, frame-rate, memory and session metrics on the device and
  sends nothing itself; expo-observe dispatches them (expo-app-metrics 57.0.22 read in its package on
  2026-10-14: no uploader, its network code only monitors the app's own requests). No finding.

## Re-verify on upgrade

```sh
npm view posthog-react-native version time --json | tail -5
npm pack posthog-react-native@<version> && tar xzf posthog-react-native-<version>.tgz
grep -n "defaultOptIn\|captureAppLifecycleEvents\|disableGeoip\|personProfiles" package/dist/types.d.ts \
  node_modules/@posthog/core/dist/types.d.ts
tr ';' '\n' < package/dist/posthog-rn.js | grep -n "reloadRemoteConfigAsync\|captureAppLifecycleEvents"
grep -n "reset(propertiesToKeep" -A18 node_modules/@posthog/core/dist/posthog-core.js
grep -n "async flagsAsync" -A5 node_modules/@posthog/core/dist/posthog-core.js
grep -n "async _flush()" -A4 node_modules/@posthog/core/dist/posthog-core-stateless.js
grep -o "EVENTS_STORAGE_FILE='[^']*'\|LOGS_STORAGE_FILE='[^']*'" package/dist/storage.js   # clearPosthogStorage keys
grep -A14 '"peerDependencies"' package/package.json   # new optional plugins to classify
# the React Native reset override lives in the source map:
node -e 'const m=require("./package/dist/posthog-rn.js.map");const s=m.sourcesContent[m.sources.findIndex(x=>x.includes("posthog-rn"))];console.log(s.slice(s.indexOf("reset(propertiesToKeep"),s.indexOf("reset(propertiesToKeep")+900))'
```

Then rerun `node ${CLAUDE_SKILL_DIR}/scripts/check-analytics.mjs .` and update this file and the
facts table.
