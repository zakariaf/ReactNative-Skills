# The runner and the devices

How `npm run e2e:ios` and `npm run e2e:android` run every flow on a Release build, on devices nobody
else uses, with the large-text step and the network sampler in the same run, and what each report says.

## Contents

- What a run needs
- What the runner does
- The build guard
- Devices: iOS simulators
- Devices: Android emulators
- One device, one driver port
- The large-text step
- Reports and how to read them
- Options and iterating
- When something fails
- The files
- When multi-package

## What a run needs

- **A Release build of a test variant** (development or preview; preview is the default for E2E):
  - iOS: ios-simulator-build's `npm run build:ios:sim -- --variant preview` puts the `.app` in
    `build/ios-sim/dd/Build/Products/Release-iphonesimulator/` (contract key `ios.appPath`); an EAS
    simulator build (`eas build --local --profile preview` with `ios.simulator: true`) works with
    `--app-path` after extracting its `.app`.
  - Android: android-emulator-build's `npm run build:android:emu -- --variant preview` keeps the
    Release APK at `build/android-emu/app-preview.apk` (contract key `android.apkPath`; the next clean
    prebuild deletes `android/`, so never point at Gradle's own output), or a local EAS APK with
    `--app-path`. A preview build signed with the debug keystore is fine for an emulator.
  Release builds embed the JavaScript bundle (Hermes bytecode), so no Metro runs: a development-client
  or Debug build talks to Metro over a WebSocket, which hides the app's own traffic and adds the dev
  menu. The test-only code (the debug link, the debug menu) is in development and preview builds and
  absent from production (debug-menu-and-test-hooks).
- **Ads off, when the app has ads**: build the E2E build with `ADS_MODE=off` (admob-ads-and-consent;
  an EAS `e2e` profile that extends `preview` with `env.ADS_MODE`, or the variable exported for the
  local build). With ads off the app never shows Google's consent form or Apple's tracking prompt and
  its ad SDK opens no socket; with ads on, the form covers every id after each cleared launch in a
  regulated region and the ad SDK's sockets break the network proof. `contracts/e2e.json`
  `buildExtra: { "adsMode": "off" }` makes the runner refuse any other build (below). Ads flows run by
  hand on an `ADS_MODE=test` build, in a manual folder (`ads-smoke`, admob-ads-and-consent).
- **The tools**: Xcode 26.6 selected through `DEVELOPER_DIR` (ios-simulator-build's `toolchain.ts`)
  and the iOS 26.5 runtime; the Android SDK with `platform-tools`, `emulator`, `cmdline-tools/latest`
  and the system image (`ANDROID_HOME`, default `~/Library/Android/sdk`); Java 17; macOS's `lsof`,
  `pgrep` and `unzip`.
- **The app's facts** in `contracts/e2e.json` (production ids, network policy, locales).

## What the runner does

`scripts/e2e/run-e2e.ts --platform <ios|android>`:

1. Parses the command line (`e2e-cli.ts`, pure, with its test). `--help` prints every option; a bad
   line prints the message and the usage line and exits 2 without a stack.
2. Reads `contracts/e2e.json` (`e2e-config.ts`, valibot; a wrong contract is exit 2 with the key).
3. Reads the build and refuses a Debug, production or ads-on build (next section) before any device
   is touched.
4. Runs `install-maestro.sh` (idempotent, checksum-verified).
5. Opens the phone, `<prefix>-e2e-phone` (or `<prefix>-<purpose>` with `--sim`), installs the build,
   pins the status bar, sets the default text size and the light appearance.
6. Empties `reports/e2e/<platform>/` and starts the socket sampler for the phone (network-proof
   reference); the sampler creates `network.txt` when it starts and rewrites its status after every
   sample.
7. **Flows**: one `maestro --device <id> --driver-host-port <port> test` on every
   `.maestro/flows/<area>/*.yaml` (listed explicitly: Maestro runs only a folder's top level), with
   `--format JUNIT`, `--output reports/e2e/<platform>/junit.xml`, `--test-output-dir`,
   `--exclude-tags quarantine,a11y`, `-e APP_ID=<id>` and `-e APP_SCHEME=<scheme>`.
8. **Large text**: the a11y flows at the largest text size (below).
9. Proves every sampler watched until the end (`proveSamplersAlive`: each status read twice, 2.5 s
   apart, must have grown and must show the app found at least once), stops them, writes
   `network-samplers.json` and `run.json` (with every device of the run), and exits 1 for a failed
   flow, a failed large-text run, a sampler that was not watching or any line in `network.txt`; 2 for
   bad input.

## The build guard

`build-guard.ts` reads the build, never the repo, because the repo describes what would be built, not
what was:

- iOS: `EXConstants.bundle/app.config` (the public app config expo-constants embeds) gives the bundle
  id and the URL scheme; `main.jsbundle` in the `.app` proves a Release build; `Info.plist`'s
  `CFBundleExecutable` (through `plutil`) is the process name the sampler looks for.
- Android: `assets/app.config` in the APK (expo-constants' Gradle task writes it for every variant)
  gives the package and the scheme; `assets/index.android.bundle` proves a Release build. Read with
  `unzip`, no Android build tools needed (checked on a preview APK of the reference app: both files
  are there, and `readAndroidBuild` read `com.example.harness.preview` and `harness-preview`).

`e2eBuildProblem` refuses a build without the embedded bundle, a build whose id is in
`contracts/e2e.json` `productionAppIds`, and a build whose embedded `extra` (expo.extra) does not
hold every `buildExtra` value, each with what to build instead. An app with
`react-native-google-mobile-ads` sets `buildExtra: { "adsMode": "off" }` (admob-ads-and-consent writes
`adsMode` into `extra` through `adsExtra`; `check-e2e-setup` rule `e2e-ads-off`); an app without ads
removes the key. Never allow an ad SDK's hosts in `allowHosts` to get a green run: ad traffic is not
deterministic, and the run would then prove nothing about it. Analytics and crash reporting follow
the test build's own configuration (off by default in development and preview builds); a host the
test build intentionally reaches is a privacy decision (network-proof reference).

## Devices: iOS simulators

`ios-device.ts` builds on ios-simulator-build's `scripts/ios/simulators.ts`:

- `ensureSimulator` finds `<prefix>-<purpose>` on the pinned runtime or creates it once (and warms it
  up: a 12-hour clock, one throwaway screenshot), then `simctl bootstatus <udid> -b` boots it. Only
  dedicated, named simulators are used; never `booted`, never another session's.
- When the Mac has no room for another simulator, the boot error becomes what to do: shut down your
  own simulators by UDID (`xcrun simctl shutdown <udid>`), never another session's, or reuse one with
  `--sim <purpose>`.
- `install`, `status_bar ... override --time 9:41 ...` (`statusBarArgs`), `ui <udid> content_size`
  (`large`, or `accessibility-extra-extra-extra-large` for large text) and `ui <udid> appearance`.
- The models come from the contract (`ios.phone`, `ios.tablet`; default iPhone 17 Pro Max and
  iPad Pro 13-inch (M5), both available for iOS 26.5 locally and on GitHub's macOS 26 runners).

## Devices: Android emulators

`android-device.ts`:

- The AVD `<prefix>-<purpose>` is created once from `android.systemImage` with the hardware profile
  `android.phoneDevice` / `tabletDevice` (`avdmanager create avd -n <name> -k <image> -d <device>`; the
  "custom hardware profile?" question is answered no). Install the image first:
  `sdkmanager "system-images;android-36;google_apis;arm64-v8a"` (x86_64 on Intel and CI). android-emulator-build
  documents the image, acceleration and CI flags.
- A running emulator of that AVD is reused: the runner asks each attached emulator its AVD name
  (`adb -s <serial> emu avd name`). Otherwise it starts one on the first free even console port from
  5554 (`emulator -avd <name> -port <port> -no-snapshot-save -no-boot-anim -no-audio -no-window`) and
  polls `adb -s emulator-<port> shell getprop sys.boot_completed` until it reads 1.
- Every adb call goes through `adbArgs(serial, ...command)`: `-s <serial>` first. A bare `adb shell`
  fails with two devices attached, and with one it may be another session's. `adbArgs` is
  android-emulator-build's one adb binding (`scripts/android/adb-args.ts`, imported, never copied):
  that skill is already a prerequisite of `e2e:android`, whose build comes from `build:android:emu`.
- Demo mode is sent again right before every Maestro run: a freshly booted emulator's SystemUI dropped
  the first broadcasts once (the clock showed the real time).
- `install -r`, demo mode for the status bar (`settings put global sysui_demo_allowed 1`, then the
  `com.android.systemui.demo` broadcasts: clock 0941, battery 100, Wi-Fi level 4, no notification
  icons), `settings put system font_scale 1.0 | 2.0` and `cmd uimode night yes | no`.
- Edge-to-edge is on by default on Android 15 and later (apps targeting API level 36 get it): screenshots include the
  status and navigation bar areas, which demo mode keeps still.
- Verified on an Android API 35 emulator (2026-10-14): the runner, demo mode, font scale, the
  `/proc/net` reads and `pm list packages -U` ran end to end there. The API 36 default image
  (`android.systemImage`) is not yet run end to end; the first run on it confirms these facts (or
  pass an API 35 image in the contract until then).

## One device, one driver port

Every Maestro run of the tooling goes through `runMaestro(bin, { id, driverPort }, args)` in
`maestro-run.ts`: `maestroGlobalArgs` puts `--device <id> --driver-host-port <port>` before the
command, with one free port per device for the whole run (`devicePorts`) unless the session passes
`--driver-port`. It prints
`maestro: device <id>, driver port <port>: test <flow>` for the log, the line the definition of done
asks you to look for. No `--udid`, no 7001, no "the only device".

## The large-text step

Every `flows/a11y/*.yaml` (tag `a11y`), with `--include-tags a11y`, at the largest system text size
(iOS AX5, about 3.6x in React Native's font scale; Android font scale 2.0), once per
`contracts/e2e.json` `largeText.locales` entry (`-e LANG=<locale>`; the flow sets it through
`subflows/set-language.yaml`, alone, before its other setup link), first on the phone, then on the
tablet (`<prefix>-e2e-tablet`, created on first use, watched by its own sampler). Reports and screenshots go to
`reports/e2e/<platform>/large-text/<phone|tablet>-<locale>/`; open every screenshot: clipping, overlap,
rows that should stack. The text size is reset to the default afterwards. accessibility-as-code owns
what such a flow looks at; its template goes to `.maestro/flows/a11y/01-large-text-core-screens.yaml`.

## Reports and how to read them

| File | What it says |
|---|---|
| `reports/e2e/<platform>/run.json` | which devices and build ran, the tag filter (null for evidence), whether large text ran, the network mode |
| `reports/e2e/<platform>/junit.xml` | one `<testcase>` per flow: `name` (the flow's `name:`), `file`, `status` (`SUCCESS`, `WARNING`, `ERROR`), its tags, and a `<failure>` such as `Assertion is false: id: tasks.list is visible` |
| `reports/e2e/<platform>/network.txt` | each line a socket the policy does not allow; empty proves something only with live samplers (next row) |
| `reports/e2e/<platform>/network-samplers.json` | one entry per device: `samples`, `appSamples` (samples that found the app), `lastError`, `problems` (empty: watched until the end) |
| `reports/e2e/<platform>/large-text/<device>-<locale>/` | JUnit, log and screenshots of the a11y flows at the largest size |
| `reports/e2e/<platform>/<timestamp>/` | per-flow command logs and screenshots, the driver logs |

`node ${CLAUDE_SKILL_DIR}/scripts/check-e2e-report.mjs . --platform <ios|android>` reads them and prints
the evidence lines (examples/evidence-report.md shows a passing run's lines).

## Options and iterating

`--sim <purpose>` (this session's own devices), `--driver-port <n>` (one port for the session),
`--app-path <path>`, `--include-tags <tags>` (passed to `maestro test`), `--skip-large-text`. Any other
option is refused (exit 2), so a typo never changes the run silently. A filtered or shortened run is
recorded in `run.json` and `check-e2e-report` refuses it as evidence (`run-filtered`). One flow by hand:
`tools/maestro/bin/maestro --device <udid or serial> --driver-host-port <port> test <flow> -e APP_ID=<id> -e APP_SCHEME=<scheme>`.

## When something fails

| Symptom | Cause | Fix |
|---|---|---|
| `e2e: ... is a Debug build` | the `.app` / `.apk` loads JS from Metro | build Release (`build:ios:sim`, the release APK) |
| `e2e: ... is the production variant` | a store build has no debug link | build the preview variant |
| `e2e: ... has "test" for extra.adsMode` | an ads-on build | rebuild with `ADS_MODE=off` |
| `network: the sampler on ... never found the app` | wrong executable or package, or the app crashed at launch | read `lastError` in `network-samplers.json`; iOS: `pgrep -f` the pattern by hand; Android: `adb -s <serial> shell pm list packages -U <package>` |
| `network: the sampler on ... exited before the end` | the sampler crashed (its stderr is in the run log) | fix the error and rerun; never pass a run without the proof |
| `Unable to launch ... Java` / `JAVA_HOME` errors | no JDK 17 | install one, or set `JAVA_HOME`; ask the developer if neither exists |
| every flow waits 15 s on its first id | the link never arrived (no test-only code, wrong scheme) or the id is wrong | `check-flows` first; then open the per-flow screenshot |
| `debug.setup-error` asserted visible | the app refused the link | the error screen names the parameter; fix the query |
| a tap "works" but nothing happens | the list was still scrolling | `waitForAnimationToEnd` before the tap |
| `simctl could not boot ... no room` | other simulators fill the Mac | shut down your own by UDID, or `--sim` |
| the emulator never reports `boot_completed` | no acceleration, wrong image ABI | android-emulator-build's checklist |
| `network.txt` lists a host | the app opened a socket its policy does not allow | network-proof reference |

## The files

| Template | Repo path |
|---|---|
| `install-maestro.sh` | `scripts/e2e/install-maestro.sh` |
| `run-e2e.ts`, `e2e-cli.ts`, `e2e-config.ts`, `e2e-device.ts`, `build-guard.ts`, `open-device.ts`, `ios-device.ts`, `android-device.ts`, `maestro-run.ts`, `maestro-args.ts`, `network-sampler.ts`, `sample-sockets.ts`, `sampler-evidence.ts`, `capture-screenshots.ts`, `screenshots-cli.ts`, `screenshot-compare.ts`, `png-diff.ts`, `write-gallery.ts` (+ their tests) | `scripts/e2e/` |

`open-device.ts` loads `ios-device.ts` (and through it ios-simulator-build's `scripts/ios/`) only for
an iOS run, and nothing else imports the iOS layer, so an app that tests Android alone runs
`e2e:android` without it.

They run under Node's type stripping (`node scripts/e2e/run-e2e.ts`), import each other with the
`.ts` extension, need no package beyond valibot (already in the app), and pass tsc, ESLint and
Prettier with the repo config. The npm scripts:

```json
{
  "e2e:ios": "node scripts/e2e/run-e2e.ts --platform ios",
  "e2e:android": "node scripts/e2e/run-e2e.ts --platform android",
  "screenshots:ios": "node scripts/e2e/capture-screenshots.ts --platform ios",
  "screenshots:android": "node scripts/e2e/capture-screenshots.ts --platform android"
}
```

## When multi-package

Each Expo app workspace keeps its own `scripts/e2e/`, `.maestro/`, `contracts/e2e.json` and npm
scripts, and runs from its folder (`npm run e2e:ios -w apps/mobile`); `tools/maestro` and `reports/`
then sit in the app folder too. The checkers find the apps from `package.json` `workspaces`
(`check-e2e-report` runs per app folder).
