# The EAS lane and the Android counterpart

The local lane (prebuild + xcodebuild on this Mac) is this skill's default for a simulator smoke build:
it needs no account, runs in minutes and uses the pinned Xcode. Teams that build on EAS check an EAS
simulator build the same way, and the Android emulator build mirrors every step (`android-emulator-build`
owns it).

## Contents

- An EAS simulator build
- Installing it on a named simulator
- Checking it
- The Android counterpart of every step
- Device rules on both platforms

## An EAS simulator build

A build profile with `ios.simulator: true` produces a simulator `.app` instead of a signed archive
(Expo docs, "iOS Simulator builds", read 2026-10-04). Extend the variant profile so the variant
variables and the EAS environment stay the ones `app-variants-and-environment` set:

```json
{
  "build": {
    "preview": {
      "environment": "preview",
      "env": { "APP_VARIANT": "preview", "EXPO_PUBLIC_APP_VARIANT": "preview" },
      "distribution": "internal"
    },
    "preview-simulator": { "extends": "preview", "ios": { "simulator": true } }
  }
}
```

```sh
eas build --platform ios --profile preview-simulator                     # on EAS: downloads as a .tar.gz
DEVELOPER_DIR=/Applications/Xcode-26.6.app/Contents/Developer \
  eas build --platform ios --profile preview-simulator --local --output build/eas/preview-simulator.tar.gz
```

- `--local` runs the EAS build steps on this Mac with its own tools (`--output`, "Output path for local
  build", read in eas-cli 24.10.0); it ignores the profile's image fields, has no build cache and no
  secret EAS variables (Expo docs, "Run EAS Build locally"). Pass `DEVELOPER_DIR` so it uses the pinned
  Xcode.
- A cloud build uses the Xcode of its build image (`ios.image` in eas.json); the build log names it.
- EAS workers set `CI=1` but start from a fresh machine; a `--local` build shares this Mac's Metro cache,
  so the cache key (rule 4) matters there exactly as in the local lane.
- Building on EAS spends the account's build minutes: ask the developer before the first cloud build.

## Installing it on a named simulator

```sh
eas build:run -p ios --path build/eas/preview-simulator.tar.gz --simulator <udid>
```

Without `--simulator`, `eas build:run` installs on the first booted simulator it finds
(`getFirstBootedIosSimulatorAsync` in eas-cli 24.10.0's `run/ios/simulator.js`, read 2026-10-04), which
on a shared Mac may be another session's. Pass the UDID of your own `<prefix>-<purpose>` simulator
(`ensureSimulator()`), or extract the archive and install by hand:

```sh
mkdir -p build/eas/preview && tar -xzf build/eas/preview-simulator.tar.gz -C build/eas/preview
xcrun simctl install "$UDID" build/eas/preview/<Scheme>.app
xcrun simctl launch --terminate-running-process "$UDID" "$BUNDLE_ID"
```

## Checking it

`check-sim-app` reads any simulator `.app`, wherever it was built:

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-sim-app.mjs . --app build/eas/preview/<Scheme>.app --variant preview --xcode <the Xcode that built it>
```

`--xcode` is needed only when the build image's Xcode is not the repo's pin (a cloud build); a `--local`
build with the pinned `DEVELOPER_DIR` passes without it. Then screenshot, `check-screenshot.mjs` and look,
exactly as for a local build.

## The Android counterpart of every step

Not run by this skill; the Android column is what `android-emulator-build` runs (its native run on
2026-10-14 confirmed or replaced the facts first read here on 2026-10-04); that skill is the source of
truth for every Android step.

| Step | iOS (this skill) | Android (`android-emulator-build`) |
|---|---|---|
| Toolchain pin | Xcode through `DEVELOPER_DIR` (`toolchain.ts`) | JDK 17 through `JAVA_HOME`, the Android SDK through `ANDROID_HOME` (compileSdk and targetSdk 36) |
| Clean native project | `npx expo prebuild --platform ios --clean` | `npx expo prebuild --platform android --clean` |
| Release build | `xcodebuild -configuration Release -sdk iphonesimulator ... CODE_SIGNING_ALLOWED=NO` | `./gradlew --no-daemon :app:assembleRelease -PreactNativeArchitectures=<host abi>` in `android/` (the template signs local release builds with the debug keystore; Play uploads use the upload key, `android-release-play`) |
| Dedicated device | `simctl create <prefix>-<purpose>`, then the UDID | `avdmanager create avd -n <prefix>-<purpose>`, `emulator -avd <prefix>-<purpose> -port <even port>` on a console port the run picked, so its serial (`emulator-<port>`) is known before the boot, confirmed with `adb -s <serial> emu avd name` |
| Install and cold start | `simctl install`, `simctl launch --terminate-running-process` | `adb -s <serial> install -r app-release.apk`, then `adb -s <serial> shell am start -S -W -n <component>` with the component from `cmd package resolve-activity --brief <package>` |
| Screenshot | `xcrun simctl io <udid> screenshot <file>` | `adb -s <serial> exec-out screencap -p > <file>` (check with `check-screenshot.mjs --size <W>x<H>`) |
| Ready signal | marker file in the data container, else a still screen | the process alive (`pidof`), its activity resumed (`dumpsys activity activities`), an empty crash buffer, and a still screen or a logcat `readyLog` line (a Release build logs JS to `ReactNativeJS`); `run-as` reads app files only in debuggable builds |
| Deep link | Maestro sub-flow (iOS asks "Open in ...?") | `adb -s <serial> shell am start -W -a android.intent.action.VIEW -d <scheme>://<path>` (a chooser only when two installed apps claim the scheme) |
| Variant proof | `check-sim-app` on the `.app` (sentinel in `main.jsbundle`) | the same sentinel in `assets/index.android.bundle` inside the APK |

## Device rules on both platforms

`check-sim-setup` applies both sides to every tooling file (`scripts/**` sources, any `*.sh`, and the
package.json scripts), because one Mac often runs simulators and emulators of several sessions at once:

- iOS: simctl targets a UDID or a variable holding one (never `booted`, `all` or a literal simulator
  name), simulators are created only as `<prefix>-<purpose>`, `xcodebuild -destination` is
  `id=<udid>` (or `generic/platform=...` for a build that runs nowhere) in shell text and in argument
  lists (`sim-safety`); Maestro starts with `--device <udid> --driver-host-port <port>`, from a free
  port, in JS/TS spawns, `.sh` files and npm scripts alike (`maestro-device`).
- Android: every adb device command is `adb -s <serial> <command>` (or built by an `adbArgs(serial)`
  helper), never `adb -e` / `adb -d`, and emulators start by AVD name, `emulator -avd <name>`
  (`adb-device`). android-emulator-build owns the Android device rules (`adb-device`,
  `emulator-avd`, `shared-machine`) and `adbArgs`; this checker keeps its copy of `adb-device` on
  purpose, as a guard for iOS-first repos that have not adopted that skill yet. The two agree; when
  they differ, android-emulator-build's rule is the one to follow.
