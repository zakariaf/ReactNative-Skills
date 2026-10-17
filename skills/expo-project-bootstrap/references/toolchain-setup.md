# Toolchain setup from zero

What a machine needs before the skeleton can be installed and built, which steps need the developer,
and how to check each one. Read it at the start of a bootstrap, or when a check reports the wrong
Node, npm, Xcode, JDK or Android SDK.

## Contents

- The verified toolchain
- What the bootstrap itself needs
- Human steps (ask once)
- Agent steps
- Selecting Xcode without xcode-select
- The Android side
- Checks before installing
- Prebuild facts worth knowing early
- EAS Build and the local lane

## The verified toolchain

Verified on 2026-10-03 and used again on 2026-10-14 (re-verify each line with its command):

| Tool | Version | Pinned by | Re-verify |
|---|---|---|---|
| Node.js | 26.4.0 (minimum 22.18: type stripping for `app.config.ts`, `metro.config.js` and the `.ts` scripts) | `.nvmrc`; `engines.node` `>=22.18` with `engine-strict=true` | `node --version` |
| npm | 11.17.0 (ships with Node 26.4.0; the first npm that reads `min-release-age-exclude`) | `engines.npm` `>=11.17.0` | `npm --version` |
| git | any current release | none | `git --version` |
| Xcode (iOS builds only) | 26.6 (iOS SDK 26.5) | `DEVELOPER_DIR` in every build script | `xcodebuild -version` |
| CocoaPods (iOS prebuild only) | 1.17 or newer under the Ruby it was installed with | none | `pod --version` |
| JDK (Android builds only) | 17 (React Native 0.86's Gradle plugin builds with `jvmToolchain(17)`) | `JAVA_HOME` | `java -version` |
| Android SDK (Android builds only) | platform 36 (compileSdk and targetSdk 36), build-tools, platform-tools (`adb`), emulator | `ANDROID_HOME` | `sdkmanager --list_installed` |

Node 26 becomes LTS on 2026-10-28; after that, move `.nvmrc` to the newest 26.x LTS that is at least
7 days old, with a full gate run. A CI image with an older npm runs `npm install -g npm@11.17.0`
first (`engine-strict` refuses the install otherwise).

## What the bootstrap itself needs

The bootstrap (the files, `npm install`, every gate, `npx expo config`) needs only Node, npm and git.
Xcode, CocoaPods, the JDK and the Android SDK matter from the first native build on
(eas-build-and-submit for EAS, ios-simulator-build and android-emulator-build for the local lane).
Do not block the bootstrap on them; ask for them in the same message as the other human steps.

## Human steps (ask once)

These need a password, `sudo`, a licence acceptance or an account. Ask for them in one message, name
each step and the default that applies until it is done; never work around one.

1. **Xcode** (macOS, for iOS builds): install it from the Mac App Store or developer.apple.com; with
   several versions keep the version in the name (`/Applications/Xcode-26.6.0.app`). Accept the
   licence and run the first launch with that Xcode's own `xcodebuild` (`sudo` drops
   `DEVELOPER_DIR`):

   ```sh
   sudo /Applications/Xcode-26.6.0.app/Contents/Developer/usr/bin/xcodebuild -license accept
   sudo /Applications/Xcode-26.6.0.app/Contents/Developer/usr/bin/xcodebuild -runFirstLaunch
   ```

   Xcode 26 does not bundle the iOS simulator runtime: it is a separate download
   (`DEVELOPER_DIR=/Applications/Xcode-26.6.0.app/Contents/Developer xcodebuild -downloadPlatform iOS`,
   handed off to ios-simulator-build, which owns simulators). Expect to keep about 60 GB free: Xcode
   is about 15 GB, the iOS runtime about 8 GB, and DerivedData plus Pods take several GB per app.
2. **Android SDK licences**: `sdkmanager --licenses` asks the developer to read and accept each
   licence; an agent never pipes `yes` into it.
3. **Store accounts and signing**: an Apple Developer team, a Google Play developer account and, when
   EAS is used, an Expo account. Signing keys, keystores, `.p8` files and `credentials.json` are the
   developer's; the agent never opens, prints, copies or commits them, and the skeleton's agent
   settings deny reading them.
4. **Trusting the folder** in the coding agent once (project permission rules are ignored in an
   untrusted workspace).

## Agent steps

```sh
node --version && npm --version            # v26.4.0, 11.17.0 (nvm use / mise install reads .nvmrc)
git rev-parse --is-inside-work-tree || git init   # hooks install through "prepare" only in a repository
```

Export `EXPO_NO_TELEMETRY=1` and `CI=1` for tooling runs: no CLI telemetry and no interactive prompt.
`npx expo install --check` and `expo-doctor` (inside `npm run check:deps`) contact Expo's API; that is
development tooling, not app traffic.

## Selecting Xcode without xcode-select

Never run `sudo xcode-select`. Build scripts find the Xcode whose `Contents/Info.plist`
`CFBundleShortVersionString` is the pinned version and export
`DEVELOPER_DIR=<app>/Contents/Developer` for every child process:

```sh
/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" /Applications/Xcode-26.6.0.app/Contents/Info.plist
DEVELOPER_DIR=/Applications/Xcode-26.6.0.app/Contents/Developer xcodebuild -version   # Xcode 26.6
```

Why: a second Xcode (a beta, or the next major at `/Applications/Xcode.app`) silently changes every
build that picks "the" Xcode; the next major can need an SDK move first (expo-sdk-upgrade).

## The Android side

- `ANDROID_HOME` points at the SDK (Android Studio's default is `~/Library/Android/sdk` on macOS,
  `~/Android/Sdk` on Linux); `$ANDROID_HOME/platform-tools` holds `adb`.
- `JAVA_HOME` points at a JDK 17 (Android Studio's bundled JBR is one).
- Gradle comes from the wrapper prebuild writes (`android/gradlew`); never install Gradle globally.
- Devices are always named: `adb -s <serial> ...`, emulators started by AVD name
  (`emulator -avd <project>-<purpose>`); never "the only connected device".
- Apps draw edge-to-edge: Android 15 enforces it for target API 35 and above (the skeleton targets
  36), and Expo has no opt-out since SDK 54, so safe-area insets are always handled in the layout
  (adaptive-layout). Predictive back is opt-in through `android.predictiveBackGestureEnabled`: Expo
  writes `android:enableOnBackInvokedCallback="false"` otherwise; the skeleton sets `true`
  (navigation-and-routing says how Back reaches the screens). Read from Expo's SDK 57 config plugins,
  not yet checked on an emulator by this skill.

## Checks before installing

```sh
node --version          # v26.4.0 (>= 22.18 at least)
npm --version           # 11.17.0 (engine-strict refuses an older one)
git rev-parse --is-inside-work-tree   # true
```

From the first native build on:

```sh
DEVELOPER_DIR=/Applications/Xcode-26.6.0.app/Contents/Developer xcodebuild -version   # Xcode 26.6
pod --version           # CocoaPods for the iOS prebuild
java -version           # 17
"$ANDROID_HOME/platform-tools/adb" version
```

## Prebuild facts worth knowing early

The build skills own prebuild; these facts shape the skeleton:

- `ios/` and `android/` are generated (Continuous Native Generation) and git-ignored (`/ios`,
  `/android` in `.gitignore`); every native setting goes through `app.config.ts` and config plugins
  (expo-prebuild-and-config-plugins), never a hand edit.
- The iOS workspace and scheme names come from `expo.name` without spaces; the Android package and the
  iOS bundle id come from the variant identity in `app.config.ts`. Each variant's name differs, so its
  prebuild writes `ios/<SanitizedName>.xcworkspace` (`TasksDev`, `TasksPreview`, `Tasks`); local build
  scripts read the name from `npx expo config`, never a literal (ios-simulator-build).
- Export `APP_VARIANT` and `EXPO_PUBLIC_APP_VARIANT` with the same value for the whole run: prebuild
  evaluates the config, and Metro inlines the public value into the bundle. `app.config.ts` throws on
  a mismatch or an unknown variant (app-variants-and-environment).
- Every icon `app.config.ts` names must exist, or prebuild and EAS Build stop with ENOENT; the
  bootstrap draws placeholder art for every variant, icons-app-icon-and-splash replaces it.

## EAS Build and the local lane

EAS Build and EAS Submit are the default (eas-build-and-submit writes `eas.json` with one build
profile per variant). The local lane (`npx expo prebuild`, `xcodebuild` or `./gradlew`, then the store
upload tools) stays complete for teams without EAS (ios-simulator-build, android-emulator-build,
ios-release-testflight, android-release-play). The bootstrap writes nothing that ties the app to
either lane.
