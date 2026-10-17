# The iOS privacy manifest

## Contents

- Why the app aggregates every pod's manifest
- PRIVACY_MANIFESTS and its wiring
- Required reasons an Expo SDK 57 app ships
- After every prebuild: audit-privacy-manifest.mjs and npm run audit:privacy
- Tracking and tracking domains
- Collected data
- Android has no privacy manifest

## Why the app aggregates every pod's manifest

Since 2024 App Store Connect requires a reason for every use of a "required-reason API" (user
defaults, file timestamps, system boot time, disk space, active keyboards) and rejects an upload
with ITMS-91053 when one is missing. SDKs ship their own `PrivacyInfo.xcprivacy`, but Apple does not
reliably read the manifests of static CocoaPods, and React Native pods are static. So the app's own
manifest declares every reason any of its pods declares. The fix for a gap is always an entry in
`src/config/privacy-manifest.ts`, never an edit of `ios/`, which prebuild rewrites.

## PRIVACY_MANIFESTS and its wiring

```ts
// app.config.ts
import { PRIVACY_MANIFESTS } from './src/config/privacy-manifest.ts';
// ...
ios: { bundleIdentifier: identity.appId, privacyManifests: PRIVACY_MANIFESTS },
```

When an SDK skill adds collected data types to the app's manifest, the module is spread first and
the types sit beside it (the one wiring every skill uses; `privacy-manifest` accepts both forms):

```ts
ios: {
  bundleIdentifier: identity.appId,
  privacyManifests: {
    ...PRIVACY_MANIFESTS, // this skill: required reasons, NSPrivacyTracking false, no domains
    NSPrivacyCollectedDataTypes: [
      ...analyticsCollectedDataTypes(projectRoot), // analytics-and-consent, from contracts/analytics.json
      ...SENTRY_COLLECTED_DATA_TYPES, // crash-reporting-and-observability: crash, other diagnostic (+ performance when tracing)
    ],
  },
},
```

`PRIVACY_MANIFESTS` holds no collected data types, so nothing is overwritten; if it ever gains some,
merge them into the same list. Sentry's three required reasons (UserDefaults `CA92.1`,
SystemBootTime `35F9.1`, FileTimestamp `C617.1`) are already in the template, from React Native, so
crash reporting adds only collected types. The analytics module reads a JSON file with `fs`, which is
why it lives in `scripts/analytics/` and is spread in `app.config.ts` rather than imported by the pure
`src/config/privacy-manifest.ts`.

Prebuild writes `ios/<App>/PrivacyInfo.xcprivacy` from `ios.privacyManifests`, and Xcode copies it
into the app. `audit-repo.mjs` checks the module exists, keeps `NSPrivacyTracking: false`, lists no
`NSPrivacyTrackingDomains`, is wired in the app config (`privacy-manifest`), and declares the
reasons the installed packages' own manifests declare (`required-reason`, from
`assets/privacy-facts.json` `requiredReasons`), so the common gaps show up before any prebuild. The
template's test pins the list, so adding a reason is a reviewed change.

## Required reasons an Expo SDK 57 app ships

Read from the packages' own manifests on 2026-10-14 (re-verify:
`find node_modules -name PrivacyInfo.xcprivacy -not -path '*/Pods/*'` and `plutil -p` each file):

| Category | Reason | Declared by |
|---|---|---|
| `NSPrivacyAccessedAPICategoryUserDefaults` | `CA92.1` | react-native 0.86.3 (React-Core), expo-constants, expo-localization, expo-notifications, expo-system-ui, expo-task-manager; Google Mobile Ads, UMP |
| `NSPrivacyAccessedAPICategoryFileTimestamp` | `C617.1` | react-native (React-Core, cxxreact, RCT-Folly, boost, glog), expo-application |
| `NSPrivacyAccessedAPICategoryFileTimestamp` | `0A2A.1`, `3B52.1` | expo-file-system 57.0.7 |
| `NSPrivacyAccessedAPICategorySystemBootTime` | `35F9.1` | react-native (React-timing, boost); Google Mobile Ads |
| `NSPrivacyAccessedAPICategoryDiskSpace` | `E174.1`, `85F4.1` | expo-file-system 57.0.7 (both); Google Mobile Ads (`E174.1`) |

`expo` depends on `expo-file-system` and `expo-constants`, so every Expo app needs the template's
seven reasons in four categories. Other SDKs add theirs: run the audit after every prebuild and add
what it reports.

A local Expo module (`modules/<name>/ios`, native-modules-and-new-architecture) is a development pod
with no manifest of its own, and its JavaScript never shows its native calls. `audit-repo.mjs` reads
its Swift and Objective-C for required-reason symbols (`assets/privacy-facts.json`
`nativeReasonSymbols`: `UserDefaults`, file timestamps, `systemUptime`/`mach_absolute_time`, volume
capacity, `activeInputModes`) and fails a category `privacy-manifest.ts` does not declare at all
(`required-reason`, with the file and line). It cannot pick the reason: choose it from Apple's list.
The scan is textual (a symbol in a comment counts, a call through another name does not), and a
local module that opens connections is layer C's business (network-layers.md).

## After every prebuild: audit-privacy-manifest.mjs and npm run audit:privacy

```sh
npx expo prebuild --platform ios --clean        # runs pod install (macOS)
node ${CLAUDE_SKILL_DIR}/scripts/audit-privacy-manifest.mjs .
npm run audit:privacy                            # the app's own copy of the check (template)
```

Both read exactly the manifests CocoaPods puts into the app:

- trunk pods' manifests under `ios/Pods/<pod>/` (inside their frameworks or bundles);
- development pods' manifests (Podfile.lock `EXTERNAL SOURCES` built from a local `:path` or
  `:podspec`, every Expo module and React Native itself), which CocoaPods never copies into
  `ios/Pods` but bundles from the pod's own folder, as `ios/Pods/Local Podspecs/<pod>.podspec.json`
  names them in `resource_bundles` or `resources` (top level, `ios`, or a subspec). CocoaPods reads
  each entry as a glob (`React/Resources/*.{xcprivacy,bundle}`), so the audit expands it in the
  pod's folder; a folder that is missing or a named file it cannot read fails
  (`unreadable-manifest`): a manifest nobody read is a manifest nobody checked. Reading `ios/Pods`
  alone once missed seven development pods and three expo-file-system reasons.

Rules: `missing-reason` (a pod declares a reason the app does not), `app-tracking`,
`tracking-outside-declared`, `undeclared-collection`, `prebuilt-stale` (the prebuilt manifest lacks
a reason `privacy-manifest.ts` declares: `ios/` is older than the module, prebuild with `--clean`).
Binary plists are parsed without `plutil`, so the skill's checker also runs on Linux against a
copied `ios/` folder; the npm script uses `plutil` (macOS).

## Tracking and tracking domains

The app's own manifest keeps `NSPrivacyTracking: false` and lists no `NSPrivacyTrackingDomains`:
the app's code tracks nothing, and iOS fails requests to listed domains for everyone who has not
granted App Tracking Transparency, which would stop ads or attribution for them. Tracking SDKs
declare their own tracking in their pods' manifests. Only pods of SDKs declared `"tracking": true`
may do so: any other tracking pod means an analytics or attribution SDK slipped in
(`tracking-outside-declared`). A pod tracks when it sets `NSPrivacyTracking`, lists tracking domains,
or collects any data type with `NSPrivacyCollectedDataTypeTracking` true: Google Mobile Ads 13.6.0
sets no `NSPrivacyTracking` key and lists no domains, and says it only on its Device ID row.

## Collected data

Pods also declare `NSPrivacyCollectedDataTypes`. Each one must appear in the `collects` of the SDK
that brings the pod, with the same or stronger `linked` and `tracking` answers and every purpose the
pod names (mapped through `assets/data-types.json` `nsPurpose`) (`undeclared-collection`); a
collecting pod no declared SDK lists fails too. One SDK entry answers for all its pods, so a type two
pods collect takes the stronger answers and the union of their purposes. The checker prints the
input for the App Privacy answers (`collected <pod>: <type> linked=… tracking=…`).

Copy the rows from the prebuilt pods, never from memory or a blog post: on 2026-10-14 Google Mobile
Ads 13.6.0 named Developer's Advertising or Marketing for six of its seven types, which most
published examples leave out. `examples/contracts/privacy.json` passes this audit on a real SDK 57
prebuild with Google Mobile Ads, UMP, Sentry, expo-iap and expo-updates.

## Android has no privacy manifest

Google Play has no machine-readable SDK manifests: the Data safety answers come from
`contracts/privacy.json` and the SDK vendors' disclosure pages, and the merged release manifest's
permissions are checked by `audit-app-bundle.mjs --android-manifest` (references/release-audit.md).
Google's SDK Index lists SDKs' data practices; check it when declaring an Android SDK.
