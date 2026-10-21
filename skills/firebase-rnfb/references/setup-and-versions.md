# Setup and versions

How React Native Firebase (RNFB) gets into an Expo app: which version, which packages, the config
plugins, the iOS linkage, the per-variant config files, and what changed in the last majors. Every
version fact here is dated with the command that re-checks it; Firebase and Expo move faster than
memory. Facts were read on 2026-10-21 from the RNFB documentation (rnfirebase.io: the install page,
"iOS SPM Support", "Migrating to v26" and "Migrating to v27"), the RNFB 26.4.0 and 27.0.0 npm tarballs
(typings and `app.plugin.js` files), the invertase/react-native-firebase issue tracker, and npm.

## Contents

- Which version
- Packages and install
- Install scripts to review
- Expo config plugins
- iOS: dynamic frameworks and Swift Package Manager
- Android
- Per-variant config files (never committed)
- Development builds only
- The modular API
- Known issues
- Re-verify everything

## Which version

| Fact | Value (verified 2026-10-21) | Re-verify |
|---|---|---|
| Latest RNFB | 27.0.0, published 2026-10-19; every package in lockstep | `npm view @react-native-firebase/app version time --json` |
| Newest release past the 7-day release age | **26.4.0** (2026-09-05): the pin this skill uses | same command; 27.0.0 passes the age on 2026-10-26 |
| Majors | 22 (2025-04-25), 23 (2025-08-07), 24 (2026-04-01), 25 (2026-06-23), 26 (2026-07-29), 27 (2026-10-19) | `npm view @react-native-firebase/app time --json` |
| New Architecture | required since v26 (every package is a TurboModule) | the "Migrating to v26" page |
| Namespaced API | removed in v26.0.0 for app, firestore, auth, functions, storage, app-check and the other main packages | the "Migrating to v26" page |

The library's dependency policy refuses releases younger than 7 days (`min-release-age=7` in the
app's `.npmrc`; dependency-management owns it), so the default is **26.4.0** for every
`@react-native-firebase/*` package, exactly pinned and all at the same version. Moving to 27 is a
planned upgrade once it is old enough: bump every package together, raise Android `minSdk` to 24 and
the Kotlin Gradle plugin to 2.4.0 or newer, remove any `disableSPM` / static-framework opt-out (v27
is Swift Package Manager only), and read "Migrating to v27" (Cloud Messaging contract fixes, AI Logic
removals, `@react-native-firebase/ml` discontinued).

## Packages and install

Install only what the app uses. The Tasks app needs:

```sh
npm install -E @react-native-firebase/app@26.4.0 @react-native-firebase/firestore@26.4.0 \
  @react-native-firebase/app-check@26.4.0 @react-native-firebase/auth@26.4.0
npx expo install expo-build-properties expo-dev-client
```

Add `@react-native-firebase/functions@26.4.0` for callables and `@react-native-firebase/storage@26.4.0`
for uploads. RNFB packages are not in Expo's SDK module map, so they are pinned exactly (`-E`) rather
than through `npx expo install`; `expo-build-properties` is Expo's (`~57.0.22` for SDK 57, verified
2026-10-21 with `npm view expo-build-properties dist-tags --json`, tag `sdk-57`). Add a row for each
package to the app's `contracts/dependency-policy.json` (dependency-management's format) and, for
the network-capable ones, to `contracts/privacy.json` (privacy-and-store-declarations).

**The Firebase JS SDK (`firebase`) is not a substitute on iOS and Android.** On React Native its
Firestore has no persistent cache (IndexedDB persistence needs a browser; the React Native build falls
back to a memory cache, and firebase-js-sdk issue 7947 asking for one is still open, checked
2026-10-21), so writes queued offline live only in memory and are gone when the app is killed (an
inference from the memory-only cache; no official sentence says it). RNFB wraps the native SDKs, whose
cache persists. Put `firebase` in the app's `doNotAdd` list; RNFB itself depends on it internally for
its web fallback (27.0.0 pins `firebase@13.0.0`), which is fine.

## Install scripts to review

With `strict-allow-scripts=true` in `.npmrc`, installing RNFB 26.4.0 stops on two transitive
install scripts (seen on 2026-10-21 with npm 11 in a copy of an Expo SDK 57 app):

- `@firebase/util@1.15.2` (postinstall: `node ./postinstall.js`)
- `protobufjs@7.6.6` (postinstall: `node scripts/postinstall`)

Review each script, then the developer approves the exact `"<pkg>@<x.y.z>": true` keys in the root
`package.json` `allowScripts` (dependency-management's rule: never `--dangerously-allow-all-scripts`).
Re-check after any version change with a dry install in a scratch copy.

## Expo config plugins

A module needs a `plugins` entry only when it ships an `app.plugin.js` (it has native install steps).
Verified in the 27.0.0 tarballs on 2026-10-21 (re-verify: `ls node_modules/@react-native-firebase/*/app.plugin.js`):

| Package | `app.plugin.js` | Plugin entry |
|---|---|---|
| `@react-native-firebase/app` | yes | yes |
| `@react-native-firebase/auth` | yes | yes |
| `@react-native-firebase/app-check` | yes | yes (iOS registers the provider factory before `FirebaseApp.configure()`; JS still calls `initializeAppCheck`) |
| `@react-native-firebase/crashlytics` | yes | yes |
| `@react-native-firebase/firestore`, `functions`, `storage` | no | none |

## iOS: dynamic frameworks and Swift Package Manager

RNFB resolves the Firebase Apple SDK with **Swift Package Manager by default** on React Native 0.75 <!-- stack-pin-ignore: the RNFB docs name the oldest React Native with SPM support -->
and newer, and SPM requires dynamic frameworks. So the app config adds, verified for 26.4.0 and 27.0.0
in the install page on 2026-10-21:

```ts
['expo-build-properties', { ios: { useFrameworks: 'dynamic' } }],
```

- **Not `useFrameworks: 'static'`.** Static linkage with the default SPM mode makes `pod install` (and
  so `npx expo prebuild`) fail. Up to 26.4.0 there is a CocoaPods opt-out (`disableSPM: true` on the
  app plugin, `useFrameworks: 'static'`, every RNFB module in `forceStaticLinking`); v27 removes it.
  Keep the default.
- The Firebase Apple SDK needs Xcode 26.2 or newer and the Swift 6.2.3 toolchain (the install page,
  2026-10-21); the library's stack uses Xcode 26.6.
- Verified by reading the docs and issues, not by building an iOS app in this skill's checks.

## Android

- `google-services.json` arrives through `android.googleServicesFile`, which the app plugin wires
  into the Gradle build (the plugin's documented job; its Gradle changes were not re-read here).
  27.0.0 raises `minSdk` to 24 ("Migrating to v27"); check the app's `minSdkVersion` before that move.
- The Android emulator reaches the computer at `10.0.2.2`. RNFB also rewrites `localhost` and
  `127.0.0.1` to `10.0.2.2` for the Firestore, Auth, Functions and Storage emulators on Android and
  logs that it did (read in the 27.0.0 sources, 2026-10-21); the emulator config names the host
  explicitly so nothing depends on the rewrite. A physical device needs the computer's LAN address.

## Per-variant config files (never committed)

Each build variant (development, preview, production; app-variants-and-environment owns them) talks
to its own Firebase project or app, so each has its own `GoogleService-Info.plist` and
`google-services.json`. They identify the project and its API keys, so they stay out of git:

1. In EAS, create a **file** environment variable per platform and environment: `GOOGLE_SERVICES_PLIST`
   and `GOOGLE_SERVICES_JSON` in `development`, `preview` and `production` (the developer uploads the
   files in the EAS dashboard or with `eas env:create --type file`; outward-facing, so ask first).
2. In `app.config.ts`: `ios.googleServicesFile: process.env['GOOGLE_SERVICES_PLIST']` and
   `android.googleServicesFile: process.env['GOOGLE_SERVICES_JSON']`. During an EAS job the file is
   written outside the project and its path is assigned to the variable (Expo's "Environment
   variables in EAS" FAQ, read 2026-10-21; re-verify on docs.expo.dev/eas/environment-variables/faq).
   For local `npx expo run:*` builds, a fallback to a git-ignored local copy
   (`process.env['GOOGLE_SERVICES_JSON'] ?? './google-services.json'`) is fine.
3. In `.gitignore`: `GoogleService-Info.plist` and `google-services.json` (also any per-variant copies
   kept locally for `npx expo run:ios`).

`check-rnfb.mjs` (`config-file-committed`) fails on such a file that `.gitignore` does not ignore and
on a literal `googleServicesFile` path. A file already in git history stays readable there: rotate its
API key restrictions in the Google Cloud console if it was ever public (a human step).

## Development builds only

RNFB is native code, so it never runs in Expo Go: the app runs as a development build
(`expo-dev-client`, EAS profile `development`). With `expo-dev-client`, native crashes are caught by its
overlay and do not reach Crashlytics during development (the install page's warning, 2026-10-21).

## The modular API

Every call is a named function taking the instance first, mirroring the Firebase JS SDK. Verified
exported from the package roots in the 26.4.0 typings on 2026-10-21:

| Package | Functions used here |
|---|---|
| app | `getApp` |
| firestore | `initializeFirestore`, `getFirestore`, `connectFirestoreEmulator`, `collection`, `doc`, `query`, `where`, `orderBy`, `onSnapshot`, `writeBatch`, `serverTimestamp`, `increment`, `setDoc`, `updateDoc`, `deleteDoc`, `waitForPendingWrites`, `CACHE_SIZE_UNLIMITED` (-1); `runTransaction` exists and is not used on the client |
| auth | `getAuth`, `onAuthStateChanged`, `onIdTokenChanged`, `signInAnonymously`, `connectAuthEmulator(auth, 'http://host:9099')` (a URL) |
| functions | `getFunctions(app?, regionOrCustomDomain?)`, `httpsCallable(functions, name, options?)`, `connectFunctionsEmulator(functions, host, port)` |
| storage | `getStorage`, `ref`, `putFile(ref, localPath, metadata?)` (RNFB-specific, returns an upload task), `getDownloadURL`, `connectStorageEmulator` |
| app-check | `initializeAppCheck(app?, { provider, isTokenAutoRefreshEnabled })` (returns synchronously in 26.4.0), `ReactNativeFirebaseAppCheckProvider`, `getToken`, `onTokenChanged` |

The namespaced style (`firestore().collection(...)`, `firebase.app()`, a default import) was removed
in v26; `check-rnfb.mjs` (`namespaced-api`) reports it.

## Known issues

Checked on 2026-10-21 with `gh issue view <n> -R invertase/react-native-firebase`:

- **9322** (closed 2026-09-23, fix only in 27.0.0): with SPM and dynamic frameworks on Expo SDK 57,
  GoogleUtilities classes are duplicated in `RNFBAnalytics` and `RNFBMessaging` (a runtime warning;
  no crash seen in the report). It concerns analytics and messaging, which this skill does not add;
  an app that adds them on 26.4.0 should move to 27 once it passes the release age.
- **9354** (open): "NativeRNFBTurboApp is not registered" on some setups; usually a stale native build
  (rerun `npx expo prebuild --clean` and rebuild the development client).
- **9382** (open): modular `where(..., 'in', ...)` and `or()` still capped at 10 values.

## Re-verify everything

```sh
npm view @react-native-firebase/app version time --json         # latest, dates, release age
npm view @react-native-firebase/firestore@26.4.0 version         # every package at the pin
npm view expo-build-properties dist-tags --json                  # the sdk-57 tag
gh issue view 9322 -R invertase/react-native-firebase            # known issues above
```

Then read the RNFB install page (Expo section) and "iOS SPM Support" for the linkage line, and redo
the install-scripts dry run.
