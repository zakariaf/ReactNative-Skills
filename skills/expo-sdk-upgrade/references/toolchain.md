# The build toolchain: Xcode, Android, EAS images, scene support

How the Xcode and the Android toolchain that build the app are chosen and recorded, when a different
one is allowed, what EAS images to name, and the one extra step SDK 57 needs before Xcode 27 may build
it. Read it before any Xcode, Android SDK or EAS image change, and when a checker reports
`scene-support`, `xcode`, `eas-image`, `android-sdk` or `store-deadline`.

## Contents

- Where the checkers find the Xcode version
- Selecting Xcode on a Mac (local lane)
- EAS images (default lane)
- Moving to another Xcode
- Building SDK 57 with Xcode 27: scene support
- Verifying scene support
- After the move to SDK 58
- Android: SDK levels, AGP, JDK
- Store deadlines
- Human steps

## Where the checkers find the Xcode version

`check-sdk-alignment.mjs` and `check-sdk-trigger.mjs` collect every place that decides which Xcode
builds the app, and judge each one:

1. `--xcode <version>` (a one-off override; nothing else is read);
2. the file `rn-skills.config.json` names in `"xcodeVersionFile"` (a bare version, or a file with an
   `XCODE_VERSION = '…'` constant);
3. `.xcode-version` at the repo root (one line, `26.6`; the file `xcodes` and several CI actions read);
4. a toolchain module anywhere in the repo's scripts or packages that exports
   `XCODE_VERSION = '26.6'` (the local build lane ios-simulator-build sets up);
5. every eas.json build profile whose `ios.image` is an exact image name
   (`macos-tahoe-26.5-xcode-26.6` → 26.6).

With none of these and no eas.json the Xcode rules print `SKIP eas.json [xcode] not yet created
(eas-build-and-submit creates it)`; with an eas.json whose profiles name no image (or `auto`) the
checker notes that EAS picks the image for the app's SDK.

## Selecting Xcode on a Mac (local lane)

- The build tooling finds the Xcode whose `Contents/Info.plist` `CFBundleShortVersionString` equals
  the recorded version, exports `DEVELOPER_DIR=<that app>/Contents/Developer` for every child process,
  and asserts that `xcodebuild -version` prints it. Several Xcode versions can live side by side
  (`/Applications/Xcode-26.6.0.app`, `/Applications/Xcode.app` = 27.0).
- Never `sudo xcode-select`: it changes the Mac for every other session and agent, and `sudo` is a
  human step. A tool that simply runs "Xcode.app" builds with whatever is installed there (often the
  newest major, which may need scene support first).
- Verified on 2026-10-04: Xcode 26.6 (17F113) ships the iOS 26.5 SDK and simulator runtime.

## EAS images (default lane)

Verified on 2026-10-04 (docs.expo.dev/build-reference/infrastructure):

| Alias | iOS image | Android image |
|---|---|---|
| `sdk-58` | `macos-tahoe-26.6-xcode-27.0` (Xcode 27.0) | `ubuntu-26.04-jdk-17-ndk-r27b-sdk-58` (JDK 17) |
| `sdk-57`, `latest` | `macos-tahoe-26.5-xcode-26.6` (Xcode 26.6) | `ubuntu-26.04-jdk-17-ndk-r27b-sdk-57` (JDK 17) |
| (no alias) | `macos-tahoe-26.6-xcode-27.1` (Xcode 27.1 beta) | — |

- **No `image`, or `"auto"`** (the default): EAS selects the image from the app's Expo SDK and React
  Native version. This is the house default.
- **`"sdk-<n>"`**: the image EAS judges best for that SDK; it must equal the app's SDK
  (`eas-image` fails on a stale alias after a move).
- **An exact name**: reproducible; the Xcode in its name is checked like a local pin (minimum Xcode,
  scene support), and an Android name ending in `-sdk-<n>` must match the SDK.
- **Never `"latest"`**: EAS moves it with every new image release, so a new Xcode major or JDK would
  reach the build without a commit (an SDK 57 app on `latest` would build with Xcode 27 the day the
  alias moves, without scene support). `eas-image` fails on it.
- eas.json is owned by eas-build-and-submit; change an image in its own commit (or in the SDK move
  commit when it names the SDK). When multi-package each app has its own eas.json, and each is checked.

## Moving to another Xcode

Allowed when Apple or an SDK needs it, or when the developer decides to adopt a newer one. It is its
own commit: change the recorded version (or the EAS image), then run a clean prebuild, a Release
simulator build and the E2E flows. SDK 58 needs Xcode 26.4 or newer; do not wait for Xcode 27 to move
SDKs, and do not select Xcode 27 while on SDK 57 without scene support (next section).

## Building SDK 57 with Xcode 27: scene support

Apps built with the iOS 27 SDK that still use the application life cycle do not launch correctly on
iOS 27. Expo's answer for SDK 57 is `expo-build-properties` → `ios.enableSceneSupport: true`: "Adopt
the UIKit scene lifecycle in an Expo SDK 57 iOS project, as required by the iOS 27 SDK (Xcode 27) …
Only the standard SDK 57 Swift AppDelegate template is supported. Requires Expo SDK 57.0.23 or newer"
(v57 build-properties docs, read 2026-10-04). The plugin rewrites the standard Swift AppDelegate and
adds the scene manifest to Info.plist. expo-build-properties 57.0.22's source throws on a customised
AppDelegate or when the app already declares `UIApplicationSceneManifest` (read 2026-09-28). Android
is unaffected.

When the developer decides to build SDK 57 with Xcode 27, in one commit:

1. `npx expo install expo-build-properties` (SDK 57 writes `~57.0.22`; `expo` must be 57.0.23 or
   newer: `npx expo install expo@~57.0.27` first if it is older).
2. Copy `templates/scripts/config/scene-support.ts` and `scene-support.test.ts` to
   `scripts/config/`.
3. In `app.config.ts`, `import { addSceneSupport } from './scripts/config/scene-support.ts';` and wrap
   the plugin list: `plugins: addSceneSupport([...])`. It merges `enableSceneSupport: true` into an
   existing `expo-build-properties` entry (a second entry would run the plugin twice) or appends one.
4. Change the recorded Xcode version (`.xcode-version`, the toolchain constant) or the EAS image to
   the Xcode 27 one.
5. Verify (next section), then the full loop: prebuild, Release simulator build and launch, E2E,
   visual baselines.

`check-sdk-alignment.mjs` fails `scene-support` when any Xcode the builds use is 27 or later on SDK 57
and no config switches scene support on (an `addSceneSupport(...)` call, or `enableSceneSupport: true`
written in `app.config.ts`, a plugin or a config helper), and when scene support is on with an `expo`
older than 57.0.23. Copying the helper without the call does not count: the helper alone changes
nothing.

## Verifying scene support

Re-verified on 2026-10-04 in a copy of the reference app (expo 57.0.26, expo-build-properties
57.0.22): with `addSceneSupport` wrapping the plugin list of `app.config.ts`,
`npx expo config --type introspect --json` showed

```json
"UIApplicationSceneManifest": {
  "UIApplicationSupportsMultipleScenes": false,
  "UISceneConfigurations": {
    "UIWindowSceneSessionRoleApplication": [
      { "UISceneConfigurationName": "Default Configuration", "UISceneDelegateClassName": "EXExpoAppSceneDelegate" }
    ]
  }
}
```

and the plugin entry `["expo-build-properties", { "ios": { "enableSceneSupport": true } }]`. A
rehearsal on an Expo SDK 57 app (2026-09-28, sdk-58-changes.md) saw the same, built the option with
Xcode 26.6 and launched it on the iOS 26.5 simulator, so turning it on before Xcode 27 is safe (a
native build was not repeated here). Check after every prebuild (with the variant the build uses,
app-variants-and-environment):

```sh
APP_VARIANT=preview EXPO_PUBLIC_APP_VARIANT=preview npx expo config --type introspect --json \
  | node -e "let s='';process.stdin.on('data',(c)=>{s+=c;}).on('end',()=>{console.log(JSON.stringify(JSON.parse(s).ios.infoPlist.UIApplicationSceneManifest));})"
```

## After the move to SDK 58

The option is not needed from SDK 58: in the move commit remove the `addSceneSupport` call, delete
`scene-support.ts` and its test, and uninstall `expo-build-properties` if nothing else uses it.
`check-sdk-alignment.mjs` fails `scene-support` while any of them remains on SDK 58, and the readiness
scan lists them as `todo` lines.

## Android: SDK levels, AGP, JDK

- **compileSdk, targetSdk and minSdk follow the SDK** (React Native's `gradle/libs.versions.toml`,
  which Expo's Gradle setup reads): SDK 57 builds with 36 / 36 / 24, SDK 58 with 37 / 36 / 24.
- **Pins:** `expo-build-properties` `android.compileSdkVersion`, `targetSdkVersion` and
  `minSdkVersion` override them. Write one only on purpose (a higher minSdk an SDK feature needs),
  and move it with the SDK: `check-sdk-alignment.mjs` fails `android-sdk` on a pin below the SDK's
  value (a compileSdk or targetSdk left from an older SDK; a minSdk below React Native's, which Gradle
  rejects) and prints `todo` lines for pins below the next SDK's values.
- **Removed config keys:** `android.edgeToEdgeEnabled` and `newArchEnabled` are gone:
  both were removed from the app config schema in SDK 55. Android 16 (targetSdk 36) enforces edge to
  edge, and the New Architecture is the only one. `removed-config` fails while either is written.
- **Predictive back** (`android.predictiveBackGestureEnabled`, default false on SDK 57 and 58) is the
  app's choice; test the back gesture on an Android 13+ emulator after every SDK move.
- **AGP, Kotlin, NDK, JDK** move with React Native (SDK 57: AGP 8.12.0, Kotlin 2.1.20; SDK 58: AGP
  9.2.1, Kotlin 2.2.0; NDK 27.1.12297006 and JDK 17 for both). The local lane needs that JDK installed
  (`java -version`); EAS images carry it.
- Rebuild after any change: `npx expo prebuild --platform android --clean`, then a Release build on a
  named emulator (`adb -s <serial>`, android-emulator-build) or an EAS preview build.

## Store deadlines

`check-sdk-trigger.mjs` reads `assets/store-requirements.json`: the App Store's minimum Xcode for
uploads (Xcode 26 since 2026-04-28) and Google Play's minimum targetSdk (36 since 2026-08-31 for new
apps and updates; an extension can be requested until 2026-11-01). A requirement in effect that the
app does not meet fails `store-deadline`; one that starts later prints a `notice`. The fix is a
toolchain move (a newer Xcode, or deleting a low `targetSdkVersion` pin) in its own commit, or the
SDK move when only a newer SDK meets it. Requesting a Play extension is a human step in Play Console.

## Human steps

- Installing an Xcode, accepting its licence (`sudo …/xcodebuild -license accept`),
  `-runFirstLaunch`, downloading a simulator runtime, installing a JDK or an Android system image.
- Deciding to build with a new Xcode major before Apple requires it (the default is the newest Xcode
  the current SDK supports without extra steps).
- Running EAS builds (they spend build credits) and anything that uploads.
