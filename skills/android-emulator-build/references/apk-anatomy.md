# APK anatomy: what a Release APK holds and what each part proves

An APK is a ZIP file. `check-apk` reads it with Node's built-ins only (no aapt2, no Java), so it runs
in CI and on a machine without the SDK. This page says what it reads, why each part is evidence, and
how to look at the same part by hand with the SDK tools.

## Contents

- The layout
- AndroidManifest.xml: binary, merged, final
- The JS bundle
- assets/app.config
- Native libraries, ABIs and 16 KB pages
- The signing block
- Looking by hand
- APK or App Bundle

## The layout

A Release APK of an Expo SDK 57 app, built for one ABI (verified on the reference app, 2026-10-14):

```text
AndroidManifest.xml               binary XML: the merged manifest of the app and every library
classes.dex, classes2.dex, ...    the Kotlin and Java code (shrunk only when minify is on)
resources.arsc, res/              compiled resources (strings, icons, the splash)
assets/index.android.bundle       the Hermes bytecode bundle (Release only)
assets/app.config                 the public app config, written by expo-constants at build time
assets/...                        fonts and images the JS bundle references
lib/arm64-v8a/*.so                native libraries for the one ABI built (React Native, Hermes, modules)
META-INF/...                      v1 signature files (when v1 signing is on)
```

The APK Signing Block (v2 and newer signatures) sits between the last file and the ZIP central
directory; it is not a file in the listing.

## AndroidManifest.xml: binary, merged, final

The manifest in an APK is Android binary XML (a string pool, a resource-id map and element chunks),
not text. It is the merged manifest: the app's own (written by the prebuild) plus every library's,
with `tools:node="remove"` and `tools:replace` applied, and the build's values filled in
(`package` = the `applicationId`, `<uses-sdk>` from the version catalog, `versionCode`,
`versionName`). This is why the APK, not `app.config.ts` or `android/app/src/main/AndroidManifest.xml`,
is the evidence: a library can add a permission (`android.permission.CAMERA` from an image picker),
and the prebuild template itself adds `SYSTEM_ALERT_WINDOW`, `VIBRATE` and the storage permissions
unless the app blocks them.

**The permissions every Expo app starts with.** The SDK 57 prebuild template's `AndroidManifest.xml`
(expo-template-bare-minimum 57.0.30, read 2026-10-14) always requests five: `INTERNET`,
`SYSTEM_ALERT_WINDOW`, `VIBRATE`, and `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE` with
`maxSdkVersion` 32. The contract template seeds exactly these, so a freshly adopted app fails only on
what its libraries add; keep each one on purpose or remove it with `android.blockedPermissions` (an app
that never draws over other apps and never touches shared storage can block `SYSTEM_ALERT_WINDOW` and
the storage pair).

**The app's own signature permission.** androidx.core (in every React Native app) declares
`<permission android:name="${applicationId}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"
android:protectionLevel="signature"/>` and requests it, so the APK carries
`com.acme.tasks.preview.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` in preview,
`com.acme.tasks.dev....` in development and `com.acme.tasks....` in production. `ContextCompat.registerReceiver`
with `RECEIVER_NOT_EXPORTED` uses it on Android versions before 13 to keep other apps from sending to the
receiver; only apps signed with the app's own key can hold it. It is no store-form permission and must
never be blocked (blocking it breaks those receivers). `check-apk` treats any permission named
`<manifest package>.<NAME>` that the APK itself declares with `protectionLevel` signature as the app's
own and does not ask the contract for it. Another permission named after the app (a library's
`${applicationId}.permission.C2D_MESSAGE` that the APK does not declare) is written
`"${applicationId}.permission.C2D_MESSAGE"` in the contract, which `check-apk` resolves against the
manifest package, so one contract serves all three variants.

Gradle also writes the merged manifest as text:
`android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml`
(Android Gradle Plugin 8.12). The build script reads it for the deep-link scheme. `check-apk --apk`
accepts a folder whose `AndroidManifest.xml` is text, so a decoded APK (apktool) works too.

What `check-apk` reads from it: `package`, `versionCode`, `versionName`, `<uses-sdk>`, every
`<uses-permission>` and `<uses-permission-sdk-23>`, every `<permission>` the APK declares (its name and
whether `protectionLevel` is signature), the `<application>` attributes (`debuggable`,
`usesCleartextTraffic`, `allowBackup`, ...) and the `<meta-data>` values (the AdMob app id).

## The JS bundle

`assets/index.android.bundle` exists only in a build that embeds its JS: a Release build
(`createBundleReleaseJsAndAssets`). A Debug build loads the JS from Metro instead. With Hermes (the
only engine Expo SDK 57 apps use by default) the file is bytecode and starts with the 8 bytes
`c6 1f bc 03 c1 03 19 1f`. Hermes stores string literals as plain bytes, so a test-only sentinel is
found with a byte search.

## assets/app.config

expo-constants' Gradle script (`scripts/get-app-config-android.gradle`) registers `createExpoConfig`
before `preBuild`: it runs `getAppConfig.js` with the build's environment and writes the public app
config into `build/generated/assets/expo-constants/app.config`, which Gradle merges into the APK's
assets. `Constants.expoConfig` reads it at run time. It holds `android.package` and the app's `extra`
(where `app-variants-and-environment` puts `appVariant`), so it proves what the config evaluated to in
the Gradle process.

## Native libraries, ABIs and 16 KB pages

`lib/<abi>/` holds the native libraries for each ABI the build targeted (`reactNativeArchitectures`).
An emulator runs one ABI: arm64-v8a on Apple silicon, x86_64 elsewhere. An APK without that folder
installs with `INSTALL_FAILED_NO_MATCHING_ABIS`.

Android 15 devices can use 16 KB memory pages, and Google Play requires apps that target Android 15
or newer to support them (since 2025-11-01 for new apps and updates). Two things must hold for every
arm64-v8a and x86_64 library:

- each ELF `PT_LOAD` segment is aligned to 16384 bytes or more (`check-apk` reads the program headers);
- a library stored uncompressed in the APK (the default since `useLegacyPackaging` is false) starts at
  a ZIP data offset that is a multiple of 16384, so it can be mapped straight from the APK.

React Native 0.86, Hermes and the Expo modules satisfy both; a third-party library built with an old
NDK may not, and crashes at load on a 16 KB device (a `google_apis_ps16k` system image shows it on an
emulator).

## The signing block

Android 7 and newer verify the APK Signature Scheme v2 (or v3/v4), stored in the APK Signing Block
right before the central directory, ending with the magic `APK Sig Block 42`. Without it the package
installer refuses the APK (`INSTALL_PARSE_FAILED_NO_CERTIFICATES`). The emulator lane signs with the
public debug key; `check-apk` checks only that a block exists. Which key signed a store build is
`android-release-play`'s check.

## Looking by hand

The SDK tools show the same facts (the build tools folder is `$ANDROID_HOME/build-tools/36.0.0`):

```sh
$ANDROID_HOME/build-tools/36.0.0/aapt2 dump badging build/android-emu/app-preview.apk | head -5
$ANDROID_HOME/build-tools/36.0.0/aapt2 dump permissions build/android-emu/app-preview.apk
$ANDROID_HOME/cmdline-tools/latest/bin/apkanalyzer manifest print build/android-emu/app-preview.apk
$ANDROID_HOME/build-tools/36.0.0/apksigner verify --print-certs build/android-emu/app-preview.apk
$ANDROID_HOME/build-tools/36.0.0/zipalign -c -P 16 -v 4 build/android-emu/app-preview.apk
unzip -l build/android-emu/app-preview.apk 'lib/*'
unzip -p build/android-emu/app-preview.apk assets/app.config
```

`apksigner verify --print-certs` names the debug certificate (`CN=Android Debug`) for a local build;
`zipalign -c -P 16` checks the 16 KB alignment of stored libraries.

## APK or App Bundle

Google Play takes an App Bundle (`.aab`, `bundleRelease`); an emulator takes an APK
(`assembleRelease`). The bundle holds every ABI and is split by Play per device, so it cannot be
installed with adb. This skill builds and checks APKs; `android-release-play` builds, signs and checks
the bundle.
