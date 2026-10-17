# Simulator build commands, step by step

The exact commands `npm run build:ios:sim` runs, why each flag is there, the simulator models, how the
run knows the app is ready, and the simulator behaviours that were verified. Read it before writing or
changing the build script, or when a step fails and you run it by hand.

## Contents

- The run in one picture
- 1. Environment
- 2. Prebuild, post-prebuild scripts and the workspace name
- 3. The dedicated simulator
- 4. The Release simulator build
- 5. Boot, status bar, install, launch
- 6. Waiting until the app is ready
- 7. Screenshot, deep links and looking at it
- Simulator models and sizes
- Verified simulator behaviours (pitfalls)
- Other simulator commands you will need
- Speed

## The run in one picture

```text
preflight (npm scripts exist; --link flow exists)  ->  drop DerivedData built in another folder
  -> selectXcode + variantEnv (one env)  ->  ensure <prefix>-<purpose> on the pinned runtime
  -> npx expo prebuild --platform ios --clean  (ios/, pod install)
  -> npm run -s <each contract postPrebuild script>  (they may read ios/Pods)
  -> xcodebuild Release iphonesimulator arm64, no signing, -destination id=<udid>
  -> bootstatus -b, status_bar override  ->  simctl install, simctl launch --terminate-running-process
  -> poll every 500 ms until ready (marker file or still screen)  ->  simctl io screenshot
  -> reports/ios-sim/<purpose>-<variant>.png  (then: check-sim-app, check-screenshot, look at it)
```

Every step writes `build/ios-sim/logs/<step>.log`; the first failing step stops the run (exit 1) and
prints the last 30 lines of its log. A failed preflight exits 2 before anything is touched.

## 1. Environment

```sh
export DEVELOPER_DIR=/Applications/Xcode-26.6.app/Contents/Developer EXPO_NO_TELEMETRY=1 CI=1
export APP_VARIANT=preview EXPO_PUBLIC_APP_VARIANT=preview          # production: production twice
```

The script derives `DEVELOPER_DIR` from `XCODE_VERSION` (see the environment reference) and keeps all
five variables for every step. In zsh, never pass several arguments through one unquoted variable: zsh
does not word-split `$ARGS`, so `-AppleLanguages (ar)` arrives as one argument (use an array).

## 2. Prebuild, post-prebuild scripts and the workspace name

```sh
npx expo prebuild --platform ios --clean          # regenerates ios/ and runs pod install
WS=$(ls -d ios/*.xcworkspace | head -1)           # "Tasks (Preview)" -> ios/TasksPreview.xcworkspace
SCHEME=$(basename "$WS" .xcworkspace)
```

- Every build starts with a clean prebuild: `ios/` is generated and git-ignored, and any hand edit there
  is lost. Never open it in Xcode to "fix" something; change `app.config.ts` or a config plugin.
  On SDK 57 (`@expo/cli` 57.0.27) `npx expo prebuild` already cleans by default and `--no-clean` layers
  over the old folder; the script still passes `--clean` (accepted) so the intent is explicit. `npx expo
  run:ios` builds an existing `ios/` without prebuilding, one more reason it is not this lane.
- The workspace and scheme names come from the variant's `name` without spaces and punctuation, not
  from `package.json`. Always discover them (`findWorkspace()`, `schemeOf()`).
- `pod install` downloads pods, so a prebuild needs the network even when the app does not.
- The prebuild rewrites package.json's `"ios": "expo start --ios"` and `"android": "expo start --android"`
  to `expo run:ios` / `expo run:android` (`updatePkgScripts` in `@expo/cli` 57.0.27; seen 2026-10-04).
  The script writes package.json back when that is the only change (`keepPackageJson()`), so a smoke
  build leaves the repo clean; any other change stays for the developer to review.
- Right after the prebuild the script runs each npm script listed in the contract's `postPrebuild`
  (for example a privacy-manifest audit that reads `ios/Pods` and `ios/Podfile.lock`), from the repo
  root. The preflight already proved each exists.
- Prebuild writes from the config: `ios.buildNumber` to `CFBundleVersion`, `version` to
  `CFBundleShortVersionString`, `ios.config.usesNonExemptEncryption` to `ITSAppUsesNonExemptEncryption`,
  `ios.appleTeamId` to `DEVELOPMENT_TEAM`, the deployment target, `ios.infoPlist` keys verbatim, and
  `ios/<App>/PrivacyInfo.xcprivacy`.

## 3. The dedicated simulator

```sh
xcrun simctl list devices --json                  # look for "tasks-smoke" on the iOS 26.5 runtime
xcrun simctl create tasks-smoke "iPhone 17 Pro Max" com.apple.CoreSimulator.SimRuntime.iOS-26-5   # prints the UDID
```

- One simulator per purpose, named `<prefix>-<purpose>` (`tasks-smoke` by default; the prefix is the
  contract's `simulatorPrefix`, else the package name), created once and reused, always targeted by
  UDID. `ensureSimulator()` looks the name up on the pinned runtime first.
- Only prefixed simulators are ever shut down or deleted, and never with `all`: other sessions share the
  Mac (a booted simulator of another task is normal there).
- On creation `ensureSimulator()` warms the device up once: boot,
  `defaults write -g AppleLocale -string en_US` (so the status bar shows 9:41, not 09:41, on a Mac with a
  24-hour region), one throwaway screenshot (the first launch after `simctl create` can show a one-time
  system banner such as "Ready for Apple Intelligence"), then shutdown. About 30 s, once.

## 4. The Release simulator build

```sh
xcodebuild -workspace "$WS" -scheme "$SCHEME" -configuration Release -sdk iphonesimulator \
  -destination "id=$UDID" -derivedDataPath build/ios-sim/dd \
  ONLY_ACTIVE_ARCH=YES ARCHS=arm64 CODE_SIGNING_ALLOWED=NO build
```

| Flag | Why |
|---|---|
| `-configuration Release` | embeds the Hermes bytecode bundle (`main.jsbundle`); no Metro, no dev menu, no LogBox |
| `-sdk iphonesimulator`, `-destination id=<udid>` | builds for the one simulator the run uses |
| `-derivedDataPath build/ios-sim/dd` | keeps DerivedData inside the git-ignored `build/` (easy to delete) |
| `ONLY_ACTIVE_ARCH=YES ARCHS=arm64` | skips x86_64 on Apple silicon |
| `CODE_SIGNING_ALLOWED=NO` | the simulator needs no signing; no key or certificate is touched |

The app lands in `build/ios-sim/dd/Build/Products/Release-iphonesimulator/<Scheme>.app`; the log ends
with `** BUILD SUCCEEDED **`. DerivedData copied with the repo (another checkout, a moved folder) names
the old path and fails with `missing required module 'SwiftShims'`: `dropStaleDerivedData()` deletes it
first.

## 5. Boot, status bar, install, launch

```sh
xcrun simctl bootstatus "$UDID" -b                   # boots if needed and waits
xcrun simctl status_bar "$UDID" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --operatorName '' --batteryState discharging --batteryLevel 100
xcrun simctl install "$UDID" "build/ios-sim/dd/Build/Products/Release-iphonesimulator/$SCHEME.app"
BUNDLE_ID=$(plutil -extract CFBundleIdentifier raw -o - "build/ios-sim/dd/Build/Products/Release-iphonesimulator/$SCHEME.app/Info.plist")
xcrun simctl launch --terminate-running-process "$UDID" "$BUNDLE_ID"   # prints "<bundle id>: <pid>"
```

- Status-bar overrides are cleared by every reboot; apply them after each boot.
- `--batteryState charged` draws a lightning bolt; `discharging` at 100 draws a plain full battery.
- `--terminate-running-process` guarantees a cold start of the freshly installed build.

## 6. Waiting until the app is ready

Never a fixed `sleep`: builds and Macs vary. The script polls every 500 ms for at most 30 s:

1. **A ready marker (test builds).** When the contract names `readyMarker` (`{ "file":
   "Documents/test-hooks/ready.txt", "contains": "home" }`), the run reads that file in the app's data
   container without touching app code (`xcrun simctl get_app_container "$UDID" "$BUNDLE_ID" data`) and
   is ready once it holds the text. The test build writes it when its first screen is interactive (a
   `debug-menu-and-test-hooks` hook); app code cannot log to the console, so the signal is data.
2. **No marker** (production builds, or no hook yet): ready when two screenshots in a row are
   byte-identical and at least 3 s have passed since launch. Screenshots of the same screen are
   pixel-identical (verified, even across a reboot), so identical bytes mean the screen has settled.
3. **A marker file without the text**: the app is up but its first screen is not the one that marks (a
   first-run screen, a sign-in). Ready on the still-screen rule after at least 8 s.

If the app is not ready after 30 s, the run fails and names the last screenshot: look at it.

## 7. Screenshot, deep links and looking at it

```sh
xcrun simctl io "$UDID" screenshot reports/ios-sim/smoke-preview.png
```

- `simctl io screenshot` writes a PNG of the full screen at device resolution in about 0.2 s, status
  bar and Dynamic Island included, never the home indicator. It cannot write to `/dev/null`
  ("Operation not permitted"); use a real file and delete it.
- Then run `check-screenshot.mjs` (size, blank screen, a light system banner over the top) and open the
  PNG and look. A white or black screen means the build or the launch failed. Dismiss a notification
  before the screenshot counts: iOS draws it over the app.
- **A deep-linked screen:** `npm run build:ios:sim -- --variant preview --link tasks/42 --wait-for
  task-detail.screen`. After the launch screenshot the run starts Maestro with the device and a driver
  port of its own before the command (`maestroGlobalArgs`), running the contract's `linkFlow`
  (`.maestro/subflows/open-link.yaml`, e2e-maestro's) with `APP_ID`, `LINK=<scheme>://tasks/42` and
  `WAIT_FOR`. `xcrun simctl openurl` alone is not enough: iOS answers a custom scheme opened from outside
  with an "Open in ...?" prompt and the app never gets the link (seen on iOS 26.5, running or not); the
  sub-flow taps Open. The run then waits for a still screen and writes
  `reports/ios-sim/<purpose>-<variant>-link.png`. Without the flow `--link` stops in the preflight.

## Simulator models and sizes

Sizes read from the device-type profiles that ship with Xcode 26.6 (`mainScreenWidth`/`Height`/`Scale`,
2026-10-04). Safe-area insets (points, portrait, what `useSafeAreaInsets()` returns) measured on the
iOS 26.5 runtime in September 2026:

| Model (iOS 26.5 runtime) | Pixels (portrait) | Scale | Points | Safe area top / bottom (measured) |
|---|---|---|---|---|
| iPhone 17 Pro Max (default) | 1320 x 2868 | 3 | 440 x 956 | not measured |
| iPhone 17 Pro, iPhone 17, iPhone 16 Pro | 1206 x 2622 | 3 | 402 x 874 | 62 / 34 (measured on the same-size iPhone 16 Pro) |
| iPhone Air | 1260 x 2736 | 3 | 420 x 912 | not measured |
| iPhone 17e, iPhone 16e | 1170 x 2532 | 3 | 390 x 844 | 47 / 34 (notch; measured on the iPhone 17e) |
| iPad Pro 13-inch (M5) | 2064 x 2752 | 2 | 1032 x 1376 | not measured |
| iPad Pro 11-inch (M5) | 1668 x 2420 | 2 | 834 x 1210 | not measured |
| iPad Air 13-inch (M3) | 2048 x 2732 | 2 | 1024 x 1366 | not measured |
| iPad (A16) | 1640 x 2360 | 2 | 820 x 1180 | not measured |

The 62 pt top inset (Dynamic Island) is also why `check-screenshot` leaves the top 8% out of its
blank-screen test. Measure an unmeasured model before laying out against its insets.

The default (6.9-inch class) also suits App Store screenshots. `check-screenshot` expects the contract's
`deviceType` (the model the build creates its simulator with); pass `--device <model>` for another
model, or `--size WxH` for anything else (an Android emulator).

## Verified simulator behaviours (pitfalls)

| What you see | Why | What to do |
|---|---|---|
| Screenshot right after `bootstatus -b` is black with a small spinner | SpringBoard is still starting although `bootstatus` returned | wait for the ready signal; `check-screenshot` flags it (`blank-screen`) |
| "Ready for Apple Intelligence" banner over the app | first launch after `simctl create` | the warm-up takes and discards that first capture |
| Status bar shows `09:41` | the simulator inherited the Mac's 24-hour region | `xcrun simctl spawn <udid> defaults write -g AppleLocale -string en_US`, reboot, re-apply the override (done at creation) |
| `--time "9:41 AM"` rejected | only `9:41` style or an ISO date with milliseconds is accepted | use `9:41` |
| "◀ other-app" breadcrumb in the status bar | the app was launched while another app was in front | launch with `--terminate-running-process` from the home screen |
| `xcrun simctl openurl <udid> scheme://...` shows "Open in ...?" | iOS asks before opening a custom scheme; queued alerts hide the app from accessibility queries | open links through the Maestro sub-flow (`--link`); after a stray `openurl`, reboot your own simulator |
| A launch argument in a zsh variable is ignored | zsh does not word-split `$ARGS` | pass each word separately, or use an array |

## Other simulator commands you will need

```sh
xcrun simctl ui "$UDID" appearance dark                     # light | dark
xcrun simctl ui "$UDID" content_size accessibility-extra-extra-extra-large   # largest text (3.571x)
xcrun simctl launch --terminate-running-process "$UDID" "$BUNDLE_ID" -AppleLanguages "(ar)" -AppleLocale ar_EG
xcrun simctl terminate "$UDID" "$BUNDLE_ID"                 # the kill part of a kill test
xcrun simctl get_app_container "$UDID" "$BUNDLE_ID" data    # the app's data folder
xcrun simctl shutdown "$UDID"                               # your own simulator, at the end of the session
xcrun simctl delete unavailable                             # cleanup that is safe on a shared Mac
```

`-AppleLanguages "(ar)"` starts the app in that language (and right to left for an RTL locale) when the
app declares it in `CFBundleLocalizations` (expo-localization's `supportedLocales` does). Launch
arguments also reach React Native through `Settings.get('<name>')` (NSUserDefaults), which is how test
builds can receive state such as a fixed date.

## Speed

Measured on 2026-09-26 on a small app in the source project: prebuild 17 s (with `pod install`), first
Release simulator build 1 min 40 s, rebuild after a clean prebuild 1 min 6 s; creating and warming up a
new simulator about 30 s, once. The measured run of the reference app is in the example.

For a JS-only change on an unchanged native build the bundle can be swapped instead of rebuilding (about
5 s): `npx expo export:embed --platform ios --dev false --entry-file index.ts --bundle-output
out/main.jsbundle --assets-dest out/assets`, copy `main.jsbundle` into the `.app`,
`codesign --force --sign - --deep <App>.app`, then install and launch. Use it only for quick iteration
(it keeps the old `EXConstants` and Info.plist); the evidence build is always the full run.
