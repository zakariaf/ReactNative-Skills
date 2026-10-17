# Example: a preview and a production APK of the reference Tasks app, proven

A real run on 2026-10-14 (macOS 27.0 on Apple silicon, a machine shared with other sessions, JDK
17.0.11 from Android Studio's bundled runtime, Android SDK with platform 36 and build tools 36.0.0,
emulator 35.1.20, Expo SDK 57.0.26, Node 26.4.0) of a copy of the library's reference Tasks app with
this skill's templates installed. It shows what "done" looks like, a real failure the run hit and the
fix that is now in the templates, the real findings the checkers made, and the back-to-back production
step.

The copy differed from the reference app in three ways: the contract's `avdPrefix` was `rnskills` (so
the AVD was `rnskills-android-build`), `systemImage` named an image already installed
(`system-images;android-35;google_apis_playstore_ps16k;arm64-v8a`, a 16 KB page image, instead of
downloading the pinned API 36 one), and `@shopify/react-native-skia` was left out of `dependencies`
(the reference app installs it without running its install script, which copies the native libraries a
build needs; no screen imports it).

## 1. Setup check

```text
$ node ${CLAUDE_SKILL_DIR}/scripts/check-emu-setup.mjs .
check-emu-setup: 60 setup and tooling files checked, 0 problems
RESULT: PASS
```

## 2. The first attempt: a real failure

The templates first ran the Kotlin compiler inside Gradle's JVM
(`-Pkotlin.compiler.execution.strategy=in-process`, to leave no Kotlin daemon behind). After 10 min 27 s
the build failed:

```text
build:android:emu: step "gradle" failed (exit 1), see build/android-emu/logs/gradle.log:
Execution failed for task ':react-native-screens:compileReleaseKotlin'.
Execution failed for task ':react-native-masked-view_masked-view:lintVitalAnalyzeRelease'.
     Message: Metaspace
     Stack: `OutOfMemoryError:`
BUILD FAILED in 10m 27s
```

The template's `gradle.properties` caps metaspace at 512 MB, and the compiler classes filled it. The
templates now pass `out-of-process` (each compilation in a short-lived process); the same goal, no
daemon left, without the memory. That attempt also showed the downloads of a first build: the Android
Gradle Plugin installed NDK 27.1.12297006 (React Native's) and NDK 27.0.12077973 (its own default, for
`expo-updates`, a module with native code that names no NDK), each after checking the accepted licence.

## 3. The preview build

```text
$ npm run build:android:emu -- --variant preview --emu android-build --keep-emulator
build:android:emu: prebuild ...
build:android:emu: restored package.json: the prebuild had rewritten its ios/android scripts
build:android:emu: gradle ...
build:android:emu: preview APK build/android-emu/app-preview.apk (com.example.harness.preview, arm64-v8a)
build:android:emu: ready (stable-screen) on rnskills-android-build emulator-5554; screenshot reports/android-emu/android-build-preview.png
build:android:emu: open the screenshot and look at it: white or black means the app failed.
```

| Step | Time |
|---|---|
| create the AVD (the first attempt; reused here) | about 5 s |
| `npx expo prebuild --platform android --clean` | about 10 s |
| Gradle `:app:assembleRelease`, arm64-v8a, `--no-daemon` (library build folders warm from the first attempt) | 3 min 39 s |
| cold boot of the AVD (`Boot completed in 24601 ms`), install, launch, ready, screenshot | about 35 s |
| total | 4 min 28 s |

The APK is 66 MB (seven dex files, 35 native libraries for arm64-v8a, a 4.2 MB Hermes bundle).
`ready (stable-screen)`: the app has no `readyLog` yet, so the run waited for two identical screenshots
after the process was alive and its activity resumed. After the run no Gradle, Kotlin or emulator
process was left except the emulator `--keep-emulator` kept.

## 4. The screenshot

```text
$ node ${CLAUDE_SKILL_DIR}/scripts/check-emu-screenshot.mjs reports/android-emu/
check-emu-screenshot: 1 screenshots checked, 0 problems
RESULT: PASS
```

Opened and looked at: the "Tasks" header, "2 open tasks", three task rows (Answer email, Buy milk,
Water the plants, the last one dimmed as done), the gesture bar at the bottom. The intended first
screen, drawn completely. One real finding by eye: the status bar area is empty. Demo mode was on (the
home screen showed 9:41 and a full battery), but the app sets no status bar style, so its icons were
drawn light on the light header. That is an app fix (`StatusBar` from `expo-status-bar` with
`style="auto"` in the root layout), reported to the root skeleton's owner.

## 5. The APK: the evidence held, and a real finding

```text
$ node ${CLAUDE_SKILL_DIR}/scripts/check-apk.mjs . --apk build/android-emu/app-preview.apk --variant preview
SKIP src/test-only.ts [test-code] not yet created (debug-menu-and-test-hooks creates it)
FAIL build/android-emu/app-preview.apk/AndroidManifest.xml [permissions] the merged manifest requests android.permission.ACCESS_ADSERVICES_AD_ID, which the contract does not list ...
FAIL ... [permissions] ... android.permission.CAMERA ...
FAIL ... [permissions] ... com.android.vending.BILLING ...
(32 permission lines in all)
check-apk: 1 APK (preview) checked, 32 problems, 1 skipped
RESULT: FAIL (32 problems)
```

Everything else held: the Hermes bundle is embedded, the APK is not debuggable, the package is
`com.example.harness.preview` in the binary manifest and in `assets/app.config`, targetSdk 36 and
minSdk 24, the arm64-v8a libraries have 16 KB aligned segments and are stored on 16 KB boundaries
(`zipalign -c -P 16 4` agreed), and the APK carries a signing block. The app ran on the 16 KB page
image (`getconf PAGE_SIZE` printed 16384).

The contract was the template's: the five permissions the SDK 57 prebuild template always adds
(INTERNET, SYSTEM_ALERT_WINDOW, VIBRATE and the storage pair up to API 32). The merged manifest
requests 38: the reference app installs the whole canonical stack, and each library adds its own at
merge time (the image picker's CAMERA, the ads SDK's AD_ID and ad-services permissions, billing,
notifications with POST_NOTIFICATIONS, RECEIVE_BOOT_COMPLETED and two dozen launcher badge
permissions, biometrics, network state). One of the 38 is the app's own:
`com.example.harness.preview.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, which androidx.core declares
under the variant's package with `protectionLevel` signature; `check-apk` passes it without a contract
entry, which is right, because its name changes with every variant. None of them shows in
`app.config.ts`. An app either blocks the ones it does not use
(`android.blockedPermissions`) or lists them in the contract and declares them in the store forms
(`privacy-and-store-declarations`). The run that wrote this page kept the finding as it was.

## 6. The production build, back to back

```text
$ npm run build:android:emu -- --variant production --emu android-build
build:android:emu: production APK build/android-emu/app-production.apk (com.example.harness, arm64-v8a)
build:android:emu: ready (stable-screen) on rnskills-android-build emulator-5554; screenshot reports/android-emu/android-build-production.png
$ node ${CLAUDE_SKILL_DIR}/scripts/check-apk.mjs . --apk build/android-emu/app-production.apk --variant production
SKIP src/test-only.ts [test-code] not yet created (debug-menu-and-test-hooks creates it)
FAIL .../AndroidManifest.xml [ship-placeholder] the manifest package is the template bundle id (com.example.*): com.example.harness ...
FAIL .../AndroidManifest.xml [ship-placeholder] the manifest meta-data com.google.android.gms.ads.APPLICATION_ID is Google's sample AdMob app id: ca-app-pub-3940256099942544~3347511713 ...
FAIL .../assets/app.config [ship-placeholder] app.config android.package is the template bundle id (com.example.*): com.example.harness ...
(plus the same 32 permission lines and three more placeholder lines in app.config)
check-apk: 1 APK (production) checked, 38 problems, 1 skipped
RESULT: FAIL (38 problems)
```

Gradle took 2 min 22 s (2 min 33 s in all; the emulator was still running). The production APK found
the reference app's deliberate placeholders: it never ships, so it keeps the template id and Google's
sample AdMob ids in every variant. A real app's production APK must pass this rule; no option turns a
placeholder into a pass. The package and `app.config` agree on `com.example.harness`, so the variant
reached all three moments. The 32 permission lines are word for word those of the preview APK: the
app-own permission is `com.example.harness.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` here, and a contract
that listed the preview spelling literally would have failed production on it. That is why the
checker recognises the APK's own signature permission, and why a contract writes any other permission
named after the app as `${applicationId}.NAME`.

## 7. Cleanup and the report

```text
$ adb -s emulator-5554 emu kill
$ avdmanager delete avd -n rnskills-android-build
```

The report for the reviewer: preview and production APKs of the reference app built back to back on
`rnskills-android-build` (pixel_8, API 35 16 KB image, arm64-v8a); both start and draw the Tasks
screen (screenshots in `reports/android-emu/`); the status bar icons are invisible on the light
header (an app fix); `check-emu-setup` PASS, `check-emu-screenshot` PASS, `check-apk` FAIL on both
for the 32 undeclared permissions and, in production, the reference app's deliberate placeholders;
the one SKIP is the missing test-only gate.
