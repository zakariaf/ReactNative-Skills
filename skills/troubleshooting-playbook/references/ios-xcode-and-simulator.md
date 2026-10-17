# Xcode, xcodebuild and the iOS simulator

Failures while selecting Xcode, prebuilding the iOS project, building for the simulator, and running or screenshotting the app there. Match the text you see in the Symptom column, or run `find-fix.mjs --text "<first error line>"`.

Status: **verified** = seen and fixed in a real run; **documented** = read in the tool's own source or docs; **open** = not settled, the fix is the current fallback. **needs a human** = a stop: send one message and wait, never work around it. Platform: blank = both. Skill = where the full procedure lives. Reviewed on 2026-10-17 against Expo SDK 57 (expo 57.0.27), React Native 0.86.3, React 19.2.3, Xcode 26.6, Android compileSdk and targetSdk 36, Jest 29.7, Maestro 2.10; re-verify the versions with `xcodebuild -version && xcrun simctl list runtimes`.

<!-- Generated from assets/known-failures/ios.json by scripts/check-catalogue.mjs --write. Edit the JSON, not this file. -->

## Contents

- Xcode
- Prebuild
- xcodebuild
- Simulator

## Xcode

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `ios-wrong-xcode` | xcodebuild -version prints another Xcode than the pinned one, or a built app has an unexpected DTXcode | /Applications/Xcode.app is another version on this Mac, and a tool used it because DEVELOPER_DIR was not set, or someone ran xcode-select | Select the pinned Xcode per process with DEVELOPER_DIR (the toolchain helper does); never run xcode-select -s, which changes every session on the machine | verified | iOS | `ios-simulator-build` |
| `ios-xcode-newer-black-screen` | Black screen at launch after building with an Xcode newer than the pinned one on Expo SDK 57 | The newer iOS SDK expects the UIScene life cycle, which SDK 57 apps do not adopt by default | Stay on the pinned Xcode until the SDK upgrade; if a newer Xcode is required, add ['expo-build-properties', { ios: { enableSceneSupport: true } }] (expo 57.0.23 or newer) and prove the launch on a simulator | documented (expo 57.x) | iOS | `expo-sdk-upgrade` |
| `ios-xcode-licence` | You have not agreed to the Xcode license agreements | The selected Xcode was installed but its licence was never accepted | Human step: the developer runs sudo <Xcode>/Contents/Developer/usr/bin/xcodebuild -license accept in their own terminal (an agent never runs sudo) | verified, needs a human | iOS | `ios-simulator-build` |
| `ios-simctl-clt` | xcrun: error: unable to find utility "simctl" | DEVELOPER_DIR (or xcode-select) points at the Command Line Tools, not at an Xcode app | Point DEVELOPER_DIR at <Xcode>.app/Contents/Developer for the process (the toolchain helper does) | verified | iOS | `ios-simulator-build` |
| `ios-derived-data-module-cache` | ** BUILD FAILED ** in a pod: a precompiled .pcm "was compiled with module cache path" of another folder, then "missing required module 'SwiftShims'" | The repo was copied or moved: the build cleaned ios/ but kept its DerivedData folder, whose module cache still names the old path | Delete this app's own DerivedData folder (the build output folder the build script names), then rerun the same build; after copying a repo, delete its build folders and ios/ before the first build | verified | iOS | `ios-simulator-build` |

## Prebuild

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `ios-pod-download` | pod install fails downloading a pod (Google-Mobile-Ads-SDK, GoogleUserMessagingPlatform, a Skia or IAP pod): Failed to download, CDN: trunk, Couldn't connect to server | Pods are downloaded at prebuild time; no network or a CDN problem | Retry once after a few minutes; never loosen pod versions or edit the Podfile.lock by hand | verified | iOS | `ios-simulator-build` |
| `ios-skia-prebuilt-missing` | pod install fails: react-native-skia: Skia prebuilt binaries not found | @shopify/react-native-skia downloads its prebuilt Skia libraries in an install step that did not run (install scripts not approved, or an offline install) | Run npx install-skia (after reading what it fetches), or approve the package install script per the dependency policy, then prebuild again | verified | iOS | `dependency-management` |
| `ios-no-workspace` | No .xcworkspace in ios/ after prebuild | The prebuild stopped early on a config error | Read the prebuild log the build wrote, fix the config error, rerun npx expo prebuild --platform ios --clean | verified | iOS | `ios-simulator-build` |

## xcodebuild

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `ios-workspace-name` | xcodebuild cannot find the workspace or scheme named after package.json | The workspace and scheme come from expo.name with spaces and punctuation removed, not from the package name | Discover ios/*.xcworkspace after prebuild and derive the scheme from it | verified | iOS | `ios-simulator-build` |
| `ios-sim-signing` | Signing for "<App>" requires a development team (on a simulator build) | CODE_SIGNING_ALLOWED=NO is missing from the simulator build | Simulator builds never sign: Release, -sdk iphonesimulator, -destination id=<udid>, CODE_SIGNING_ALLOWED=NO | verified | iOS | `ios-simulator-build` |
| `ios-pod-native-error` | ** BUILD FAILED ** with a Swift, Objective-C or C++ error inside a pod | A native module and the SDK disagree, usually after a version change made by hand | npx expo install --check, restore the pinned versions, then prebuild with --clean; a library that still fails needs an update (dependency-management) | verified | iOS | `ios-simulator-build` |
| `ios-expo-run-debug` | npx expo run:ios made a Debug build (dev menu, JS from Metro) with whatever Xcode xcode-select points at | expo run:ios builds Debug for the default Xcode and picks a simulator itself | Build the evidence build with the build skill's script (Release, iphonesimulator, CODE_SIGNING_ALLOWED=NO, DEVELOPER_DIR, a named simulator) | documented | iOS | `ios-simulator-build` |

## Simulator

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `ios-screenshot-dev-null` | simctl io <udid> screenshot /dev/null fails: Operation not permitted | simctl cannot write its PNG to /dev/null | Write to a temporary file and delete it | verified | iOS | `ios-simulator-build` |
| `ios-black-spinner-after-boot` | A screenshot right after simctl bootstatus -b is black with a small spinner | bootstatus returns while SpringBoard is still starting | Wait for the app's ready signal (two identical screenshots a few seconds apart) before the screenshot that counts | verified | iOS | `ios-simulator-build` |
| `ios-first-boot-banner` | A system banner ("Ready for Apple Intelligence" or similar) covers the app on a new simulator | One-time system banner on the first launch after simctl create | Warm a new simulator up once and discard its first capture | verified | iOS | `ios-simulator-build` |
| `ios-status-bar-override` | The status bar shows a 24-hour time or a charging bolt after simctl status_bar override --time 9:41 | The simulator inherited the Mac region; --batteryState charged draws a bolt; overrides reset on every reboot | xcrun simctl spawn <udid> defaults write -g AppleLocale -string en_US, reboot, re-apply; use --batteryState discharging --batteryLevel 100 after every boot | verified | iOS | `ios-simulator-build` |
| `ios-status-bar-time-format` | simctl status_bar rejects --time "9:41 AM": Invalid, non-ISO date/time string | Only 9:41 style or an ISO date with milliseconds is accepted | Use --time 9:41 (or an ISO time such as ...T09:41:00.000Z) | verified | iOS | `ios-simulator-build` |
| `ios-openurl-alert` | "Open in <App>?" alert after simctl openurl; testIDs vanish from the Maestro hierarchy | iOS asks before opening a custom scheme from simctl openurl, nothing accepts the prompt, and pending alerts queue and dim the app | Open debug and deep links through Maestro's openLink in a sub-flow that waits for the alert animation, taps Open, and taps again if the alert is still there; never send them with simctl openurl | verified | iOS | `e2e-maestro` |
| `ios-zsh-word-splitting` | A launch argument such as -AppleLanguages "(ar)" stored in a shell variable is ignored | zsh does not word-split $ARGS, so the words arrive as one argument | Pass each word as its own argument (an argument array in the script, never a string) | verified | iOS | `ios-simulator-build` |
| `ios-apple-languages-ignored` | xcrun simctl launch <udid> <bundleId> -AppleLanguages "(ar)" still shows the app in English or left to right | The app does not declare the language (no CFBundleLocalizations entry), or the argument arrived as one word | Configure expo-localization's supportedLocales with the app's locales so prebuild writes CFBundleLocalizations; pass each launch argument as its own word | verified | iOS | `rtl-and-direction` |
| `ios-device-name-runtime` | simctl create "<device name>" fails: the device type is not in the runtime | Each iOS runtime ships its own device list (a new runtime drops older models) | List the device types with xcrun simctl list devicetypes for the installed runtime, and name the model in the build contract | documented | iOS | `ios-simulator-build` |
| `ios-other-sessions-simulators` | Another session's simulator was shut down, erased or reached by this session's command | simctl shutdown all / erase all / delete all, or a command that targets "booted", touch every simulator on the machine | Name simulators <project>-<purpose>, target them by UDID, shut down and delete only your own | verified | iOS | `ios-simulator-build` |
| `ios-simulator-insufficient-resources` | simctl boot exits with "Unable to boot device due to insufficient system resources" (maxUserProcs / runningUserProcs) | Too many simulators are booted on the machine, other sessions included, so the per-user process limit is reached | Shut down only this session's own simulators that are not needed now (xcrun simctl shutdown <udid>), then rerun; never shutdown all | verified | iOS | `ios-simulator-build` |
| `ios-already-booted` | Unable to boot device in current state: Booted | The simulator was already booted | Harmless: use xcrun simctl bootstatus <udid> -b, which boots only when needed | verified | iOS | `ios-simulator-build` |
| `ios-disk-full` | No space left on device, or a simulator will not boot | Old DerivedData, build folders, runtimes and unavailable simulators | Delete this repo's build output and run xcrun simctl delete unavailable; never erase simulators the tooling did not create | verified | iOS | `ios-simulator-build` |
| `ios-app-not-ready` | The build script reports that the app was not ready after its timeout | A JS error before the first screen, or the ready signal the script waits for never comes (a first-run screen that never reaches the expected screen) | Open the last screenshot, read the process log (xcrun simctl spawn <udid> log show --last 2m --predicate 'process == "<Executable>"'), fix the error; the ready signal falls back to a still screen | verified | iOS | `ios-simulator-build` |
| `ios-js-bundle-swap` | An app whose main.jsbundle was swapped for fast iteration fails to install or launch | The bundle changed after the app was signed (even ad hoc) | After copying the new bundle run codesign --force --sign - --deep <App>.app, then install and launch by UDID; the evidence build is always the full Release run | documented | iOS | `ios-simulator-build` |
