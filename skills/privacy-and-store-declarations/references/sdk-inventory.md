# The SDK inventory

## Contents

- What counts as a network-capable SDK
- Declaring an SDK
- Facts for common SDKs
- Before adding a package
- When multi-package

## What counts as a network-capable SDK

A package that opens connections by itself: the app calls its API, and the SDK decides what to send
and where. `assets/privacy-facts.json` `networkSdks` is the recogniser `audit-repo.mjs` uses:

| Family | Packages | Scope |
|---|---|---|
| ads | `react-native-google-mobile-ads` | direct dependency |
| in-app purchases (store servers) | `expo-iap` | direct |
| purchase server | `react-native-purchases`, `react-native-purchases-ui` | anywhere |
| crash reporting | `@sentry/react-native`, `@bugsnag/react-native`, `@datadog/mobile-react-native` | direct |
| backend and analytics | `@react-native-firebase/*`, `firebase` | direct |
| product analytics, telemetry | `@amplitude/analytics-react-native`, `@segment/analytics-react-native`, `posthog-react-native`, `mixpanel-react-native`, `expo-insights`, `expo-observe`, `expo-app-metrics` | direct |
| attribution | `react-native-appsflyer`, `react-native-branch`, `react-native-adjust` | direct |
| Facebook | `react-native-fbsdk-next` | direct |
| push | `expo-notifications`, `react-native-onesignal`, `onesignal-expo-plugin` | direct |
| over-the-air updates | `expo-updates` | anywhere |
| web views and browsers | `react-native-webview`, `expo-web-browser` | anywhere |
| sign-in with a provider | `expo-auth-session`, `@react-native-google-signin/google-signin` | direct |
| online detection | `@react-native-community/netinfo` (its default reachability check requests a Google URL from the app) | anywhere |
| HTTP clients | `axios`, `ky`, `got`, `node-fetch`, `cross-fetch` | direct |

"Anywhere" means a copy another package pulls in counts too (a transitive NetInfo or web view still
ships native code). Development dependencies never count: lockfile v3 marks them `"dev": true`.
System wrappers are not network SDKs: `expo-tracking-transparency` (Apple's prompt),
`expo-apple-authentication`, `expo-store-review`, `expo-network` (path monitoring, no HTTP probe).
Packages that only reach the network when the app hands them a URL or calls a transfer are covered by
layers A and B, because the URL or the call is first-party:

- `expo-image` (a remote `source`): the URL literal fails `remote-url` outside `src/config` and
  `linkFiles`; a URL built at run time from config is the case layer A cannot see (see below).
- `expo-file-system` transfers (`File.downloadFileAsync`, upload tasks, the legacy `downloadAsync`,
  `uploadAsync`, `createDownloadResumable`, `createUploadTask`): the call fails `network-call` (and
  `first-party-network` in the bundle) outside `src/api` and `networkModules`. A no-argument
  `downloadAsync()` is expo-asset copying a bundled asset and passes.
- `expo-linking`, `expo-web-browser`: hand a URL to the system; the URL lives in `linkFiles`.

What no static layer proves: a first-party file that passes a URL read from config into one of these
packages (`<Image source={{ uri: config.avatarBase + id }} />`). The base URL is in config, the
component call is not a request pattern. That is the reason for layer F (e2e-maestro's socket sampler
fails the host) and for keeping remote media out of the app unless it goes through the API.

## Declaring an SDK

Each installed network-capable package is an entry in `contracts/privacy.json` `"sdks"`
(`network-sdk` fails otherwise; `sdk-inventory` fails an entry for a package that is gone):

```json
"react-native-google-mobile-ads": {
  "family": "ads",
  "why": "banner ads on the task list for free users",
  "pods": ["Google-Mobile-Ads-SDK", "GoogleUserMessagingPlatform"],
  "maven": ["com.google.android.gms:play-services-ads", "com.google.android.gms:play-services-measurement-sdk-api", "com.google.android.ump:"],
  "tracking": true,
  "collects": [
    { "type": "device-id", "linked": true, "tracking": true, "purposes": ["third-party-advertising", "developer-advertising", "analytics"], "shared": true },
    { "type": "coarse-location", "linked": true, "tracking": false, "purposes": ["third-party-advertising", "developer-advertising", "analytics", "app-functionality"], "shared": true }
  ]
}
```

The snippet shows two of the seven rows these two pods declare; `examples/contracts/privacy.json` has all
of them, checked against a real prebuild. One SDK entry answers for all its pods, so a type two pods
collect gets the stronger linked and tracking answer and the union of their purposes (UMP adds App
Functionality to coarse location, performance data and product interaction).

- `why`: what the app uses it for, in a sentence a reviewer can check.
- `pods`: the CocoaPods trunk pods it brings (read `ios/Podfile.lock` `SPEC REPOS` after a prebuild).
  Layer D fails any trunk pod no entry lists.
- `maven`: Gradle group prefixes it brings (`./gradlew :app:dependencies --configuration
  releaseRuntimeClasspath`), for the `--gradle-deps` check. Analytics and crash artifacts of Firebase
  and Google measurement are strict: name the artifact (`com.google.android.gms:play-services-measurement-sdk-api`),
  because a bare group never covers them (network-layers.md, layer D, lists the canonical stack's groups).
- `tracking`: true when the SDK uses data for tracking (joined with other companies' data for
  advertising, or shared with a data broker). Only these SDKs' pods may declare tracking in their
  privacy manifests, and any tracking means App Tracking Transparency first (admob-ads-and-consent).
- `collects`: what the SDK collects, from its privacy manifest (`audit-privacy-manifest.mjs` prints
  it after a prebuild and fails a gap) and its vendor's data-disclosure page (the only source for
  Android). The App Privacy and Data safety answers come from these rows
  (references/store-declarations.md).

The adapter rule (only `<library>-<concern>-adapter.ts` imports the SDK) belongs to
architecture-and-boundaries (`vendorSdks` in `contracts/architecture.json`); the version and the
install belong to dependency-management. This file is about what the SDK does on the network and
with data.

## Facts for common SDKs

Verified dates in brackets; re-verify on each upgrade by reading the pod manifests
(`audit-privacy-manifest.mjs`) and the vendor's disclosure page.

| SDK | Trunk pods | Collects (from its manifest or disclosure), with the purposes the pod names | Tracking |
|---|---|---|---|
| Google Mobile Ads 13.6.0 + UMP 3.1.0 (react-native-google-mobile-ads 17.2.0) [2026-10-14, read from the prebuilt pods] | `Google-Mobile-Ads-SDK`, `GoogleUserMessagingPlatform` | GMA: Device ID (linked, tracking), coarse location, advertising data, product interaction (linked), performance data, other diagnostic data (not linked), each for Third-Party Advertising, Developer's Advertising or Marketing and Analytics; crash data (not linked) for Analytics only. UMP: coarse location, performance data, product interaction (not linked), for App Functionality. GMA sets no `NSPrivacyTracking` key and lists no tracking domains: its tracking is the Device ID row | yes (Device ID), after ATT |
| expo-iap 5.8.0 [2026-09-26] | `openiap` (Android: `io.github.hyochan.openiap:openiap-google`, Play Billing) | nothing of its own: StoreKit and Play Billing run in system services; a purchase server (IAPKit, receipt validation) adds purchase history, opted in through `contracts/in-app-purchases.json` `allowedApis` (in-app-purchases) | no |
| expo-notifications 57.0.21 [2026-10-14] | none (development pod); Android: FCM through `com.google.firebase:firebase-messaging:25.0.1` (its `build.gradle`), so `"maven": ["com.google.firebase:", "com.google.android.gms:play-services-cloud-messaging"]` | the push token (Device ID) to the app's server, for App Functionality, linked when registered with an account (`contracts/push.json` `requiresAccount`). `getExpoPushTokenAsync` also POSTs to `https://exp.host/--/api/v2/push/getExpoPushToken` from the app (push-notifications verified it); the declaration covers that call, and Expo, Apple and Google are processors of the payload (push-notifications bans personal content in it) | no |
| @sentry/react-native 7.11 (Sentry Cocoa 8.58.0) [2026-10-14] | `Sentry` | its pod manifest: crash data, performance data, other diagnostic data, none linked or tracking, each for App Functionality; required reasons UserDefaults `CA92.1`, SystemBootTime `35F9.1`, FileTimestamp `C617.1`; linked only if the app sets a user | no (scrub PII: crash-reporting-and-observability) |
| expo-updates 57.0.24 [2026-10-14] | `ReachabilitySwift` (5.2.4, from its podspec; its manifest declares `NSPrivacyTracking: false` and nothing else) | checks for and downloads updates from the update server (`u.expo.dev` for EAS Update) at every cold start and on the app's foreground checks; the requests carry the channel, runtime version, platform and the EAS client id, no personal data (ota-updates verified it) | no |
| expo-web-browser 57.0.3 (in `create-expo-app --template default@sdk-57`; `expo-auth-session` depends on it) [2026-10-14] | none (development pod) | nothing: the system browser (`SFSafariViewController`, Custom Tabs) or an auth session loads the page, outside the app's process and cookies. It is a network SDK (scope anywhere), so an app that ships it declares it with `"collects": []`; that declaration covers its bundle and native findings, and the baseline template has no entry for it | no |
| posthog-react-native 4.79.1 (analytics-and-consent's default vendor) [2026-10-14] | none (pure JavaScript, requests through `fetch` from `@posthog/core`; ships no `PrivacyInfo.xcprivacy`) | the rows of `contracts/analytics.json` `collects` (analytics-and-consent owns them; its `privacy-sync` rule keeps `sdks["posthog-react-native"].collects` an exact copy, each row `optional: true`): product interaction and the anonymous device id, for Analytics, linked to the install id, not tracking unless the analytics contract says so | only if `contracts/analytics.json` `tracking` is true |
| expo-observe, expo-insights (EAS telemetry) [2026-10-14] | none | startup metrics, logs and the EAS client id from every release build by default; analytics-and-consent fails expo-insights and fails expo-observe unless the app sets `dispatchingEnabled: false` until consent | no |
| expo-sharing 57.0.22 (canonical stack) [2026-10-14] | none (development pod) | nothing of its own; its native `urlSession` and `httpClient` code resolves the content of a URL shared into the app (`ResolveUrlContentDetails.swift`) | no |

A declared SDK's network findings in the bundle and native layers need no baseline entry: the
declaration says the app uses it to go online. `expo-updates` (native `urlSession`, `httpClient`: the
update client) is always declared. `expo-sharing` ships in the starting baseline with the reason "an
app that only shares local files out never reaches it"; an app that accepts URLs shared into it
deletes that entry and declares expo-sharing instead.

The app's own server (the `api-port` profile) is not an SDK: what it receives goes into
`app.collects`.

## Before adding a package

1. Is it network-capable (the table above, or its README talks about a server, an API key or a
   dashboard)? Then it is a declaration, a store-answer change and, for an offline-only app, a
   profile decision: stop and ask the developer before installing it.
2. Install it with dependency-management's procedure (exact pin, release age, install scripts).
3. Declare it here, prebuild, run `audit-privacy-manifest.mjs` and add the reasons and data its pods
   declare, rerun `audit-repo.mjs` and `npm run audit:network`, and hand the changed store answers
   to the developer.

## When multi-package

Run the checkers once per app with `--app <dir>` (`audit-repo.mjs . --app apps/tasks`) or with the
app folder as the repo root (the other three); each app keeps its own `contracts/privacy.json` and
baseline, because each app ships its own SDK set. With `--app`, `audit-repo.mjs` reads the workspaces
and the one `package-lock.json` from the repo root (npm workspaces keep a single lockfile there), and
the `dependencies` of every workspace package the app depends on, transitively, count as the app's
own: a `packages/ui` that depends on `react-native-webview` ships that web view in the app. The
finding names the workspace `package.json` that brings the SDK. Add the app's contract and baseline
to `quality-gates.json` `gatedPaths` with its folder (`apps/*/contracts/privacy.json`).
