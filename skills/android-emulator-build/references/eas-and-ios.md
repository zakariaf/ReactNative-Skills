# The EAS lane and the iOS counterpart

The local lane (prebuild + Gradle on this machine) is this skill's default for an emulator smoke
build: it needs no account, runs in minutes and uses the pinned JDK and SDK. Teams that build on EAS
check an EAS APK the same way, and the iOS simulator build mirrors every step (`ios-simulator-build`
owns it).

## Contents

- An EAS APK
- Installing it on a named emulator
- Checking it
- The iOS counterpart of every step
- Device rules on both platforms

## An EAS APK

An App Bundle (`.aab`, the default of an EAS Android build) cannot be installed with adb; an emulator
needs an APK. A build profile with `android.buildType: "apk"` produces one (Expo docs, "Build APKs for
Android Emulators and devices", read 2026-10-14). Extend the variant profile so the variant variables
and the EAS environment stay the ones `app-variants-and-environment` set:

```json
{
  "build": {
    "preview": {
      "environment": "preview",
      "env": { "APP_VARIANT": "preview", "EXPO_PUBLIC_APP_VARIANT": "preview" },
      "distribution": "internal"
    },
    "preview-apk": { "extends": "preview", "android": { "buildType": "apk" } }
  }
}
```

```sh
JAVA_HOME=<JDK 17> ANDROID_HOME=<sdk> \
  eas build --platform android --profile preview-apk --local --output build/eas/preview.apk
```

- `--local` runs the EAS build steps on this machine with its own tools (no build minutes, no upload);
  it has no build cache and no secret EAS variables. Pass the JDK 17 and the SDK on its environment,
  as `selectToolchain()` does.
- A cloud build spends the account's build minutes and uploads the project: ask the developer before
  the first one. `eas-build-and-submit` owns profiles, credentials and cloud builds.
- An EAS build signs with the project's credentials (EAS-managed or local), not the debug key, so an
  installed copy from the local lane must be uninstalled first (the build script's fresh install does
  this).

## Installing it on a named emulator

Not `eas build:run -p android`: it installs on the first running emulator it finds and, when none
runs, asks which AVD to boot (`selectEmulatorAsync` in eas-cli 24.12.1's `run/android/emulator.js`,
read 2026-10-14). On a shared machine the first running emulator may be another session's, and the
prompt hangs an unattended run. `check-emu-setup` (`adb-device`) fails tooling that calls it.
Install by serial on your own `<prefix>-<purpose>` AVD instead:

```sh
adb -s <serial> uninstall <pkg>
adb -s <serial> install build/eas/preview.apk
adb -s <serial> shell am start -S -W -n <pkg>/.MainActivity
```

## Checking it

`check-apk` reads any APK, wherever it was built:

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-apk.mjs . --apk build/eas/preview.apk --variant preview
```

An EAS APK holds every ABI of `reactNativeArchitectures` (four by default), so the `abi` rule passes
on any emulator; the `signature` rule sees EAS's signing block. Then screenshot,
`check-emu-screenshot.mjs` and look, exactly as for a local build.

## The iOS counterpart of every step

| Step | Android (this skill) | iOS (`ios-simulator-build`) |
|---|---|---|
| Toolchain pin | JDK 17 through `JAVA_HOME`, the SDK through `ANDROID_HOME` (`scripts/android/toolchain.ts`) | Xcode through `DEVELOPER_DIR` (`scripts/ios/toolchain.ts`) |
| Clean native project | `npx expo prebuild --platform android --clean` | `npx expo prebuild --platform ios --clean` |
| Release build | `./gradlew --no-daemon :app:assembleRelease -PreactNativeArchitectures=<abi>` (debug keystore) | `xcodebuild -configuration Release -sdk iphonesimulator ... CODE_SIGNING_ALLOWED=NO` |
| Dedicated device | `avdmanager create avd --name <prefix>-<purpose>`, `emulator -avd <prefix>-<purpose> -port <port>`, serial `emulator-<port>` | `simctl create <prefix>-<purpose>`, then the UDID |
| Identity check | `adb -s <serial> emu avd name` | the UDID from `simctl list devices --json` |
| Clean status bar | System UI demo mode | `simctl status_bar <udid> override` |
| Install and cold start | `adb -s <serial> uninstall` + `install`, `am start -S -W` | `simctl install`, `simctl launch --terminate-running-process` |
| Ready signal | process alive, activity resumed, crash buffer empty, `readyLog` or a still screen | marker file in the data container, else a still screen |
| Screenshot | `adb -s <serial> exec-out screencap -p` | `xcrun simctl io <udid> screenshot <file>` |
| Deep link | `adb -s <serial> shell am start -W -a android.intent.action.VIEW -d <url> <pkg>` | Maestro sub-flow (iOS asks "Open in ...?") |
| Variant proof | `check-apk` (sentinel in `assets/index.android.bundle`, package, `assets/app.config`) | `check-sim-app` (sentinel in `main.jsbundle`, Info.plist, `EXConstants.bundle/app.config`) |
| Stop | `adb -s <serial> emu kill` | `simctl shutdown <udid>` |

## Device rules on both platforms

Both setup checks read every tooling file (`scripts/**`, any `*.sh`, the package.json scripts):

- Android (this skill's `check-emu-setup`): every adb device command is `adb -s <serial> <command>`
  (or built by `adbArgs(serial, ...)`), never `-e`/`-d`; emulators start with `-avd <prefix>-*`;
  no `adb kill-server`, `gradlew --stop`, Gradle install tasks, `pkill` of emulators or
  `eas build:run -p android`.
- iOS (`ios-simulator-build`'s `check-sim-setup`): simctl targets a UDID, simulators are
  `<prefix>-<purpose>`, `xcodebuild -destination id=<udid>`, Maestro starts with
  `--device <id> --driver-host-port <port>`; it applies the basic adb rule (`adb-device`) as well.
- Maestro on Android takes the serial as its device: `maestro --device emulator-5556
  --driver-host-port <port> test <flow>` (`maestroGlobalArgs({ udid: serial, driverPort })`,
  `e2e-maestro` owns it).
