# The release audit: what users receive

## Contents

- What this audit owns, and what it does not
- iOS: the built app
- Android: the merged release manifest
- What each rule means
- Commands in order before a release
- Checklist

## What this audit owns, and what it does not

`audit-app-bundle.mjs` reads the artefacts a user installs and checks their privacy facts against
`contracts/privacy.json`: the shipped privacy manifest, App Transport Security and cleartext, the
development launcher's local-network keys, the tracking prompt text, a store answer for every
permission, and (production) placeholder values. The other release facts belong to the release gates,
which run on the same artefact: signing and `get-task-allow`, StoreKit test files, version and build
number, the variant embedded in `EXConstants.bundle`, the bundle id and the AdMob app id per variant
(ios-release-testflight, android-release-play, ios-simulator-build's `check-sim-app`); the test-only
sentinel (app-variants-and-environment's `check-variant-bundle`). Run both: neither repeats the other.

## iOS: the built app

```sh
rm -rf build/ipa-check && mkdir -p build/ipa-check && unzip -q "$IPA" -d build/ipa-check
APP=$(ls -d build/ipa-check/Payload/*.app)
node ${CLAUDE_SKILL_DIR}/scripts/audit-app-bundle.mjs . --app "$APP" --variant production
```

With EAS, download the build artefact first (`eas build:list`, then the artefact URL; eas-build-and-submit);
a local release archive works the same (`Products/Applications/<App>.app` inside the `.xcarchive`). A
simulator build (`.app` from `Build/Products/Release-iphonesimulator`) is good enough for every rule
here, since none of them is about signing. Info.plist and `.strings` files may be binary plists: the
checker reads them without `plutil`.

The equivalent shell checks, for a human reading along:

```sh
plutil -extract NSAppTransportSecurity.NSAllowsArbitraryLoads raw "$APP/Info.plist"   # false or absent
plutil -extract NSBonjourServices json -o - "$APP/Info.plist"                          # production: no _expo._tcp
plutil -p "$APP/PrivacyInfo.xcprivacy"                                                 # NSPrivacyTracking false, every reason
plutil -extract NSUserTrackingUsageDescription raw "$APP/Info.plist"                   # present iff the contract declares tracking
```

## Android: the merged release manifest

The manifest the user gets is the merge of the app's, every library's and the prebuild template's.
Read it from the build output:

```sh
# from an AAB or APK (Android SDK command-line tools)
"$ANDROID_HOME"/cmdline-tools/latest/bin/apkanalyzer manifest print app-release.aab > build/merged-manifest.xml
# or after a local Gradle release build
cp android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml build/merged-manifest.xml
node ${CLAUDE_SKILL_DIR}/scripts/audit-app-bundle.mjs . --android-manifest build/merged-manifest.xml --variant production
```

The intermediates path above is the Android Gradle Plugin's layout for an Expo SDK 57 project; if it
moves, search `android/app/build/intermediates` for `AndroidManifest.xml` under a `release` folder.
Both inputs may be passed in one run.

## What each rule means

| Rule | Platform | Fails when | Fix |
|---|---|---|---|
| `privacy-manifest-file` | iOS | `PrivacyInfo.xcprivacy` is not in the app | wire `ios.privacyManifests`, prebuild with `--clean` |
| `built-manifest` | iOS | the shipped manifest declares tracking or lacks a reason `src/config/privacy-manifest.ts` declares | rebuild after a clean prebuild |
| `ats` | iOS | `NSAllowsArbitraryLoads` true, or a non-localhost `NSExceptionAllowsInsecureHTTPLoads` | HTTPS; remove the exception |
| `local-network` | iOS, production | `_expo._tcp` in `NSBonjourServices` or the Expo Dev Launcher purpose text | the dev launcher's plugin strips both from Release builds ("Strip Local Network Keys for Release" build phase, expo-dev-launcher 57.0.20, read 2026-10-10): build Release, keep the phase |
| `att-string` | iOS | tracking declared but the prompt text is missing in Info.plist or an app language; or no tracking declared but the text ships | the text comes from one catalog key (admob-ads-and-consent); a child-directed app carries none |
| `permission-answer` | both | a purpose string or a runtime permission of a known kind (`permissionKinds`) without an answer in `permissionAnswers`; permissions of no kind (`INTERNET`, launcher badges, the app's own signature permission `<applicationId>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` from androidx.core) need no answer | answer it, or remove it (`android.blockedPermissions`); never block `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`: receivers registered with `RECEIVER_NOT_EXPORTED` break |
| `ship-placeholder` | iOS, production | Google's sample or the template's AdMob app id, an `example.com` link or a `__TOKEN__` in Info.plist or `expo.extra` | the real values for production |
| `android-cleartext` | Android, production | `android:usesCleartextTraffic="true"` on `<application>` | only the template's debug manifests allow cleartext (Metro) |
| `android-ad-id` | Android | `com.google.android.gms.permission.AD_ID` merged, but no SDK marked `"tracking": true` and no Device ID row for advertising or analytics (a push token's app-functionality row does not answer it) | declare it, or block the permission (a child-directed app must). When AD_ID ships, the developer also answers Play Console > App content > Advertising ID (yes, for advertising or analytics): Play asks it separately from Data safety for apps targeting Android 13 or later |

`expo-dev-client` in `package.json` is not a finding: the dev launcher and dev menu pods are
Debug-only on iOS and ship release stubs on Android. An app-defined `NSLocalNetworkUsageDescription`
survives the strip and needs a `local-network` answer and a real local-network feature.

## Commands in order before a release

1. `node ${CLAUDE_SKILL_DIR}/scripts/audit-repo.mjs .` (and `--gradle-deps` with a fresh report)
2. `npx expo prebuild --platform ios --clean`, then `node ${CLAUDE_SKILL_DIR}/scripts/audit-privacy-manifest.mjs .`
3. `npm run export:audit`, then `node ${CLAUDE_SKILL_DIR}/scripts/audit-bundle.mjs .` (or `npm run audit:network`)
4. The E2E smoke run with the guard and the sampler (e2e-maestro): zero attempts, an empty report
5. The release build, then `audit-app-bundle.mjs` on the `.app` and the merged Android manifest
6. `node ${CLAUDE_SKILL_DIR}/scripts/audit-repo.mjs . --answers`: hand the answers to the developer

## Checklist

- [ ] Every audit above prints `RESULT: PASS`.
- [ ] The answers printed by `--answers` match what App Store Connect and Play Console show (the
      developer checks; a changed answer is entered by the developer).
- [ ] When the merged Android manifest carries AD_ID, Play Console's Advertising ID declaration says
      yes with its purposes (the developer enters it; a child-directed app blocks the permission).
- [ ] When the release manifest keeps `READ_MEDIA_IMAGES` or `READ_MEDIA_VIDEO` (a custom gallery),
      Play Console's Photo and Video Permissions declaration is filled in; a save-only app blocks them
      with `android.blockedPermissions` instead (media-images-and-files).
- [ ] No key, keystore or credential in the repo, logs or reports (references/secrets.md).
- [ ] Every baseline or contract change since the last release carries a `Gate-Change:` trailer and
      the reviewer's approval.
