# Example: a preview build of the reference Tasks app, proven

A real run on 2026-10-04 (macOS 27.0 on Apple silicon, Xcode 26.6 selected through `DEVELOPER_DIR`
while `/Applications/Xcode.app` is Xcode 27.0, the iOS 26.5 simulator runtime, Expo SDK 57.0.26, Node
26.4.0, CocoaPods 1.15.2) of a copy of the library's reference Tasks app with this skill's templates
installed. It shows what "done" looks like, including a real finding the checker caught, and then the
back-to-back production step that a variant change needs.

The copy differed from the reference app in three ways: the contract's `simulatorPrefix` was
`rnskills` (so the simulator was `rnskills-sim-build`), and `@shopify/react-native-skia` and
`react-native-google-mobile-ads` were left out of `dependencies` (the reference app installs them for
other skills without their native setup: Skia's install script is not run there, and the Google Mobile
Ads SDK stops an app at launch without an AdMob app id). No screen of the app imports either.

## 1. Setup check

```text
$ node ${CLAUDE_SKILL_DIR}/scripts/check-sim-setup.mjs .
check-sim-setup: 39 setup and tooling files checked, 0 problems
RESULT: PASS
```

## 2. The preview build

```text
$ npm run build:ios:sim -- --variant preview --sim sim-build
build:ios:sim: prebuild ...
build:ios:sim: xcodebuild ...
build:ios:sim: preview app build/ios-sim/dd/Build/Products/Release-iphonesimulator/TasksPreview.app
build:ios:sim: ready (stable-screen) on rnskills-sim-build 5943E476-74D4-4466-BD92-0E6D8C1B0FBC; screenshot reports/ios-sim/sim-build-preview.png
build:ios:sim: open the screenshot and look at it: white or black means the app failed.
```

| Step | Time |
|---|---|
| select Xcode, create and warm up `rnskills-sim-build` (first run only) | 35 s |
| `npx expo prebuild --platform ios --clean` (137 pods installed) | 69 s |
| `xcodebuild` Release, iphonesimulator, arm64, cold DerivedData | 4 min 5 s |
| boot, install, launch, wait (still screen), screenshot | 24 s |
| total | 6 min 14 s |

Re-run on 2026-10-10 against the updated reference app (same command, a fresh `rnskills-sim-build`,
137 pods): the same `ready (stable-screen)`, the same screenshot and the same three `usage-strings`
findings below. It took 12 min 7 s in total (prebuild about 2 min, xcodebuild about 9 min) because
other sessions kept the Mac's load average above 30: budget for that on a shared machine.

`ready (stable-screen)`: the app has no ready marker yet, so the run waited for two identical
screenshots after at least 3 s. The scheme is `TasksPreview`: the variant's name `Tasks (Preview)`
without spaces and punctuation. The run used a Mac shared with other sessions; a warm rebuild is much
faster than the cold one.

The prebuild also rewrote package.json's `"ios": "expo start --ios"` to `"expo run:ios"`; the build
script now writes package.json back when that is the only change, so a smoke build leaves the repo
clean.

## 3. The screenshot

```text
$ node ${CLAUDE_SKILL_DIR}/scripts/check-screenshot.mjs reports/ios-sim/
check-screenshot: 1 screenshots checked, 0 problems
RESULT: PASS
```

Opened and looked at: status bar at 9:41 with a full battery and no bolt, the "Tasks" header, "2 open
tasks", and three task rows (Answer email, Buy milk, Water the plants, the last one dimmed as done). The
intended first screen, drawn completely.

## 4. The built app: a real finding

```text
$ node ${CLAUDE_SKILL_DIR}/scripts/check-sim-app.mjs . --app build/ios-sim/dd/Build/Products/Release-iphonesimulator/TasksPreview.app --variant preview
SKIP src/test-only.ts [test-code] not yet created (debug-menu-and-test-hooks creates it)
FAIL build/ios-sim/dd/.../TasksPreview.app/ar.lproj/InfoPlist.strings [usage-strings] has no NSCameraUsageDescription (the ar text for the camera) Fix: ...
FAIL build/ios-sim/dd/.../TasksPreview.app/ar.lproj/InfoPlist.strings [usage-strings] has no NSMicrophoneUsageDescription (the ar text for the microphone) Fix: ...
FAIL build/ios-sim/dd/.../TasksPreview.app/ar.lproj/InfoPlist.strings [usage-strings] has no NSPhotoLibraryUsageDescription (the ar text for the photo library) Fix: ...
check-sim-app: 1 app (preview) checked, 3 problems, 1 skipped
RESULT: FAIL (3 problems)
```

Everything else held: `DTXcode` 2660 (Xcode 26.6), `DTPlatformName` iphonesimulator,
`MinimumOSVersion` 16.4, `CFBundleIdentifier` `com.example.harness.preview` (the `.preview` suffix),
the same id in `EXConstants.bundle/app.config`, `PrivacyInfo.xcprivacy` in the bundle, no ATS exception,
and a Hermes bytecode `main.jsbundle` (4.4 MB, magic `c6 1f bc 03`). The raw evidence behind the
finding:

```text
$ plutil -p .../TasksPreview.app/Info.plist | grep UsageDescription
  "NSCameraUsageDescription" => "Allow TasksPreview to access your camera"
  "NSMicrophoneUsageDescription" => "Allow TasksPreview to access your microphone"
  "NSPhotoLibraryUsageDescription" => "Allow TasksPreview to access your photos"
$ plutil -p .../TasksPreview.app/ar.lproj/InfoPlist.strings
{
  "CFBundleDisplayName" => "المهام (Preview)"
}
```

The app asks for no permission, but `expo-image-picker` is installed, and `@expo/prebuild-config`
applies its config plugin automatically (it is in the `legacyExpoPlugins` list), which writes English
default texts. An Arabic user would read them untranslated. In a real task this is not done: remove the
module when the app does not use it, or give each usage description its text in every language through
the app config's `locales`, rebuild, and check again until `RESULT: PASS`. (English is the development
region, so the Info.plist text already serves it.)

## 5. The production step a variant change needs

Building production right after this preview build, without clearing any cache, is the strip proof:

```sh
npm run build:ios:sim -- --variant production
node ${CLAUDE_SKILL_DIR}/scripts/check-sim-app.mjs . --app build/ios-sim/dd/Build/Products/Release-iphonesimulator/Tasks.app --variant production
```

Checking the preview app as if it were production shows that the checker reads the artifact:

```text
$ node ${CLAUDE_SKILL_DIR}/scripts/check-sim-app.mjs . --app .../TasksPreview.app --variant production
FAIL .../TasksPreview.app/Info.plist [bundle-id] CFBundleIdentifier is "com.example.harness.preview", expected "com.example.harness" for a production build ...
FAIL .../TasksPreview.app/Info.plist [ship-placeholder] Info.plist CFBundleIdentifier is the template bundle id (com.example.*): com.example.harness.preview ...
FAIL .../TasksPreview.app/Info.plist [encryption-flag] ITSAppUsesNonExemptEncryption is not set, so App Store Connect asks the export-compliance question for every upload ...
```

The reference app keeps its `com.example.*` id on purpose (it never ships), so its production build
fails `ship-placeholder` by design; a real app sets its own id and `ios.config.usesNonExemptEncryption`.

## 6. The report to the developer

```text
Tasks, preview simulator build (rnskills-sim-build, iPhone 17 Pro Max, iOS 26.5), built by Xcode 26.6:
- The app launches to the Tasks screen with its three tasks (screenshot looked at).
- Not done: the Arabic InfoPlist.strings lacks the camera, microphone and photo-library texts that
  expo-image-picker's automatic plugin adds; remove the module or translate the three texts.
- No test-only gate yet (SKIP test-code until debug-menu-and-test-hooks adds it).
Evidence: reports/ios-sim/sim-build-preview.png; check-sim-setup PASS; check-screenshot PASS;
check-sim-app FAIL (usage-strings, 3 lines). Simulator shut down and deleted by UDID afterwards.
```
