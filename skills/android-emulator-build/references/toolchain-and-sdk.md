# Toolchain and SDK: JDK 17, ANDROID_HOME, the SDK packages and the human steps

What an emulator build needs on the machine, how the build script selects it per process, what only a
person may install or accept, and how the pins move with the Expo SDK.

## Contents

- The versions (verified 2026-10-14)
- Selecting JDK 17
- ANDROID_HOME and the SDK packages
- The NDK and other downloads Gradle makes
- Human steps
- Gradle on a shared machine
- The tool environment
- Moving to Expo SDK 58
- .gitignore and disk space

## The versions (verified 2026-10-14)

| What | Version | Where it comes from | Re-verify |
|---|---|---|---|
| Expo SDK | 57 (expo 57.0.26) | the app's package.json | `npm ls expo` |
| React Native | 0.86.3 | Expo SDK 57 | `npm ls react-native` |
| compileSdk / targetSdk | 36 / 36 | React Native's `gradle/libs.versions.toml`, read by Expo's root project plugin | `grep -E '^(compileSdk\|targetSdk)' node_modules/react-native/gradle/libs.versions.toml` |
| minSdk | 24 | the same file | `grep '^minSdk' node_modules/react-native/gradle/libs.versions.toml` |
| build tools | 36.0.0 | the same file | `grep '^buildTools' node_modules/react-native/gradle/libs.versions.toml` |
| NDK | 27.1.12297006 | the same file (`ndkVersion`) | `grep '^ndkVersion' node_modules/react-native/gradle/libs.versions.toml` |
| Android Gradle Plugin / Kotlin | 8.12.0 / 2.1.20 | the same file | `grep -E '^(agp\|kotlin) ' node_modules/react-native/gradle/libs.versions.toml` |
| Gradle | 9.3.1 | the wrapper the prebuild template writes | `grep distributionUrl android/gradle/wrapper/gradle-wrapper.properties` (after a prebuild) |
| JDK | 17 | React Native 0.86's Gradle plugin compiles with `jvmToolchain(17)` | `grep -rn jvmToolchain node_modules/@react-native/gradle-plugin/*/build.gradle.kts` |
| System image | `system-images;android-36;google_apis;<abi>` (not yet booted for real: the 2026-10-14 native run used `system-images;android-35;google_apis_playstore_ps16k;arm64-v8a` through the contract's `systemImage`) | this skill's pin (`systemImageFor`) | `sdkmanager --list_installed` |
| Hardware profile | `pixel_8` (1080 x 2400) | this skill's default, in every cmdline-tools since 12 | `avdmanager list device -c` |

The Gradle plugin of Expo reads the version catalog of the installed React Native, so the pins in
`scripts/android/toolchain.ts` follow that file; `check-emu-setup` (`toolchain-pin`) fails when
`ANDROID_API` or `BUILD_TOOLS_VERSION` differs from the installed catalog. An app that needs other
levels sets them with `expo-build-properties` (`android.compileSdkVersion`, `targetSdkVersion`,
`buildToolsVersion`, `minSdkVersion`), which Expo maps onto the catalog; then change the pins and the
contract's `targetSdk` / `minSdk` together. Google Play has required targetSdk 36 for new apps and
updates since 2026-08-31, so a lower target builds a working emulator APK that Play refuses.

## Selecting JDK 17

`selectToolchain()` looks at, in order: `JAVA_HOME`, then on macOS `/usr/libexec/java_home -v 17` and
Android Studio's bundled runtime (`/Applications/Android Studio.app/Contents/jbr/Contents/Home`). It
reads each candidate's `release` file (`JAVA_VERSION="17.0.11"`) and takes the first whose major is 17,
so a `JAVA_HOME` pointing at a newer JDK is skipped, not used. Android Studio's bundled runtime changes
with Studio updates (the verification machine's is 17.0.11; newer Studio releases bundle a newer
major), which is why the script checks the version instead of trusting the path.

When no candidate is JDK 17, the script stops with the human step: install a JDK 17 (Eclipse Temurin
17, or the JDK 17 of the machine's package manager) and point `JAVA_HOME` at it. Linux CI images set
`JAVA_HOME` (GitHub's runners also export `JAVA_HOME_17_X64`; pass it as `JAVA_HOME`).

Never switch the JDK for the whole machine (`jenv global`, `sdk default java`,
`update-alternatives --set java`, `sudo ln -s ... /Library/Java/JavaVirtualMachines`): other builds
on the machine, Maestro and Android Studio itself use the global default. `check-emu-setup`
(`no-global-switch`) fails tooling that does.

## ANDROID_HOME and the SDK packages

`ANDROID_HOME` names the SDK; `ANDROID_SDK_ROOT` is the deprecated name (still read as a fallback).
Without either, the script uses the SDK Manager's default folder: `~/Library/Android/sdk` on macOS,
`~/Android/Sdk` on Linux. Gradle reads `ANDROID_HOME` from its environment, so the build writes no
`local.properties` (the prebuild does not either).

The build checks these folders inside `ANDROID_HOME` before the slow prebuild (`requiredSdkPackages`):

| Package | Folder | Needed for |
|---|---|---|
| `platform-tools` | `platform-tools/` | adb |
| `emulator` | `emulator/` | the emulator binary |
| `cmdline-tools;latest` | `cmdline-tools/latest/` | avdmanager (creating the AVD), sdkmanager |
| `platforms;android-36` | `platforms/android-36/` | compileSdk 36 |
| `build-tools;36.0.0` | `build-tools/36.0.0/` | aapt2, zipalign, apksigner |
| the system image | `system-images/android-36/google_apis/<abi>/` | the AVD |

The system image is `google_apis` (Google APIs, no Play Store): `adb root` works on it and it never
asks for a Google sign-in. Its ABI must be the host's: arm64-v8a on Apple silicon, x86_64 on Intel
Macs and Linux (with KVM). A machine that already holds another image can name it in the contract's
`systemImage` (for example a 16 KB page size image, `google_apis_ps16k`, to prove page alignment on a
running device); its ABI must still be the build's ABI.

## The NDK and other downloads Gradle makes

React Native's version catalog names NDK 27.1.12297006; the app module compiles the New Architecture
glue (codegen, autolinking) with it. When the folder `ndk/27.1.12297006` is missing, the Android Gradle
Plugin downloads it on the first build (about 1 GB), which works only after the SDK licences were
accepted. A library module with native code that names no NDK gets the Android Gradle Plugin's own
default instead (27.0.12077973 for AGP 8.12): on the reference app `expo-updates` triggered that
second download (2026-10-14). Gradle also downloads its own distribution (the wrapper's 9.3.1) into `~/.gradle/wrapper` and
the Maven dependencies into `~/.gradle/caches` on the first build. Budget 10 to 20 minutes and several
GB for a first build on a fresh machine.

## Human steps

Each needs the developer (an installer, an admin password, or a legal agreement). The agent stops and
asks; it never works around one:

1. Install a JDK 17 (or Android Studio, whose bundled runtime may be 17), and set `JAVA_HOME` when it
   is not found automatically.
2. Install the Android SDK with Android Studio's SDK Manager or `sdkmanager`, then the packages in the
   table above (`sdkmanager 'platform-tools' 'emulator' 'platforms;android-36' 'build-tools;36.0.0'
   'system-images;android-36;google_apis;arm64-v8a'`).
3. Accept the SDK licences once, in their own terminal: `sdkmanager --licenses`. Tooling never pipes
   `yes` into it (`check-emu-setup` `no-global-switch`).
4. On Linux CI, make KVM available to the runner (an emulator without hardware acceleration is too
   slow to be useful).

## Gradle on a shared machine

- **No daemon.** `--no-daemon` makes the build's Gradle process exit at the end. A daemon would stay for
  three hours with about 2 GB of heap (`org.gradle.jvmargs=-Xmx2048m` in the template's
  `gradle.properties`), and a later build of another variant could reuse it.
  `kotlin.compiler.execution.strategy=out-of-process` runs each Kotlin compilation in a short-lived
  process instead of a Kotlin daemon that would outlive the build. Not `in-process`: on the reference
  app (2026-10-14) it loaded the Kotlin compiler into Gradle's JVM, and the template's
  `-XX:MaxMetaspaceSize=512m` ran out (`OutOfMemoryError: Metaspace` in `lintVitalAnalyzeRelease`
  and `compileReleaseKotlin`) after 10 minutes.
- **Never `gradlew --stop`.** It stops every daemon of that Gradle version for the user, including
  other sessions' builds in progress.
- **Never a Gradle `install*` task** (`installDebug`, `installRelease`): they install on every device
  adb lists. Install the APK with `adb -s <serial> install`.
- **One heavy build at a time.** A Release build with one ABI kept Gradle's JVM at about 2 GB, plus
  the short-lived Kotlin compiler processes, and every core for several minutes; on a machine shared by many sessions, run builds one after another.

## The tool environment

`toolEnv()` returns the base environment plus `JAVA_HOME`, `ANDROID_HOME`, `EXPO_NO_TELEMETRY=1` and
`CI=1`; the build adds `variantEnv(variant)` and hands the one object to every step. `CI=1` stops every
prompt (Expo CLI, npm) from waiting for input; it also makes `@expo/cli` keep Metro's cache in the
Release bundling task, which is why the cache key matters (`build-variants.md`).

## Moving to Expo SDK 58

Expo SDK 58 (React Native 0.88) moves compileSdk to 37, build tools to 37.0.0, the Android Gradle
Plugin to 9.2.1 and Kotlin to 2.2.0; targetSdk stays 36 and minSdk 24 (read from React Native
0.88.0-rc.3's version catalog on 2026-10-04). The move is a data change: install `platforms;android-37`
and `build-tools;37.0.0` (human step), update `ANDROID_API` and `BUILD_TOOLS_VERSION` in
`scripts/android/toolchain.ts` (the emulator image may stay on API 36; set the contract's
`systemImage` when it does), rerun `check-emu-setup` (it compares the pins with the new catalog), then
a preview and a production build. `check-apk` takes the expected targetSdk from the contract, else from
React Native's catalog `targetSdk`, and only then from `ANDROID_API`, so the compileSdk move alone does
not make it expect targetSdk 37. `expo-sdk-upgrade` owns the upgrade itself.

## .gitignore and disk space

`.gitignore` ignores `android/` (or `/android`), `build/` and `reports/` (`check-emu-setup`
`gitignore`). The space a build uses:

| What | Size | Remove with |
|---|---|---|
| `android/` after a Release build (one ABI) | 1 to 2 GB | the next clean prebuild, or `rm -rf android` |
| `node_modules/*/android/build` (library build folders Gradle writes) | 0.5 to 1 GB | `rm -rf node_modules/*/android/build` |
| `build/android-emu/` (kept APKs and logs) | 50 to 150 MB per APK | `rm -rf build/android-emu` |
| one AVD (`~/.android/avd/<name>.avd`) | 2 to 8 GB after use | `avdmanager delete avd -n <prefix>-<purpose>` |
| `~/.gradle/caches` | several GB, shared by every project | leave it; Gradle prunes it |
