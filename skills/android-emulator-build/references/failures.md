# Failures: symptom, cause, fix

Match the text of the failing step (the run prints the tail of `build/android-emu/logs/<step>.log`),
fix the cause, rerun that step, then the checks. Never weaken a check to make a build pass.

## Contents

- Toolchain and preflight
- Prebuild
- Gradle
- Emulator
- Install and launch
- Variant and APK checks
- Screenshot

## Toolchain and preflight

| Symptom | Cause | Fix |
|---|---|---|
| `JDK 17 not found (looked at: ...)` | no JDK 17 in `JAVA_HOME`, `java_home -v 17` or Android Studio's runtime | human step: install a JDK 17 and set `JAVA_HOME`; never switch the machine's default |
| `the Android SDK in <dir> lacks platforms/android-36, ...` | SDK packages or the system image missing | human step: install them with the SDK Manager or `sdkmanager '<package>'` and accept the licences |
| `preflight failed, nothing was built: package.json has no "<script>" script` | a contract `postPrebuild` script is missing | add the script and its tooling; never drop it from the contract to start the build |
| exit 2: `contracts/android-emu-build.json is not valid: ...` | a contract key has a wrong value | fix the key the message names (`check-emu-setup` names every one) |
| `APP_VARIANT=staging is not one of development\|preview\|production` | a typo in `--variant` | pass one of the three |

## Prebuild

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot find module 'expo/config'` | `node_modules` missing | `npm ci` |
| a plugin error naming one package | that package's config plugin fails for this config | fix the plugin options in `app.config.ts` (`expo-prebuild-and-config-plugins`) |
| `restored package.json: the prebuild had rewritten its ios/android scripts` | the prebuild turns `expo start --android` into `expo run:android` | nothing: the build writes package.json back; any other change stays for review |

## Gradle

| Symptom | Cause | Fix |
|---|---|---|
| `Unsupported class file major version` or `Gradle requires JVM 17 or later` | Gradle ran on another JDK | build through the script (it sets `JAVA_HOME`); check `java -version` of the selected JDK |
| `SDK location not found` | `ANDROID_HOME` unset in the Gradle process | build through the script; it passes `ANDROID_HOME` to every step |
| `Failed to install the following Android SDK packages ... NDK ... not accepted` | the SDK licences were never accepted, so the NDK download is refused | human step: `sdkmanager --licenses` in the developer's terminal |
| `No version of NDK matched the requested version 27.1.12297006` while offline | the NDK download needs the network | connect, or install `ndk;27.1.12297006` with the SDK Manager |
| a C++ or CMake error in a library's `android/` | a library's native code does not build with this SDK | update the library (`dependency-management`), or keep its build out of this app |
| `Could not resolve all files for configuration` | a Maven download failed | rerun; behind a proxy, configure Gradle's proxy in `~/.gradle/gradle.properties` |
| `OutOfMemoryError: Metaspace` in `compileReleaseKotlin` or `lintVitalAnalyzeRelease` | the Kotlin compiler ran inside Gradle's JVM (`kotlin.compiler.execution.strategy=in-process`) and filled the template's 512 MB metaspace | keep `out-of-process` (`gradleReleaseArgs`); verified on the reference app |
| `Daemon ... disappeared unexpectedly` / `OutOfMemoryError: Java heap space` | the machine ran out of memory | build one thing at a time; raise `org.gradle.jvmargs` through `expo-build-properties` or a plugin only after measuring |
| the bundling task fails with a Metro error | a JS import or syntax error | `npx expo export --platform android` shows the same error faster |

## Emulator

| Symptom | Cause | Fix |
|---|---|---|
| `did not finish booting in 5 minutes; see build/android-emu/logs/emulator.log` | no hardware acceleration, an image of another ABI, or a full disk | read the log: `x86_64 emulation currently requires hardware acceleration` (enable KVM / HVF), `CPU Architecture 'arm64' is not supported` (use the host's ABI), `Not enough space` (free disk) |
| `emulator-5556 runs "other-avd", not <prefix>-<purpose>: refusing to use it` | another session took the port between the listing and the start | rerun; the run picks the next free port |
| `every emulator console port from 5554 to 5584 is taken` | sixteen emulators run on the machine | stop your own emulators (`adb -s <serial> emu kill`); never another session's |
| `Running multiple emulators with the same AVD is an experimental feature` in the log | the AVD runs already without being listed by adb (still booting, or offline) | wait and rerun; the run finds a running AVD by its console name |
| the AVD boots to a "System UI isn't responding" dialog | a loaded machine during the first boot | rerun when the load is lower; the ready signal times out instead of passing |

## Install and launch

| Symptom | Cause | Fix |
|---|---|---|
| `INSTALL_FAILED_NO_MATCHING_ABIS` | the APK holds no library for the image's ABI | build with `--abi <the image's ABI>` (`check-apk` `abi`) |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | an installed copy signed with another key | the fresh install uninstalls it first; by hand, `adb -s <serial> uninstall <pkg>` |
| `INSTALL_PARSE_FAILED_NO_CERTIFICATES` | an unsigned or re-zipped APK | install the APK Gradle wrote (`check-apk` `signature`) |
| `INSTALL_FAILED_OLDER_SDK` | the image's API is below the app's minSdk | use an image at or above minSdk (the pinned image is API 36) |
| `has no launcher activity installed` | the package name differs from the manifest, or the install failed silently | check the APK's package (`check-apk` `application-id`) and the install log |
| `the app crashed (see the crash report)` with `JavascriptException` | a JS error at startup | fix the error; reproduce in `jest` or `expo start` |
| crash with `Missing application ID` from the Google Mobile Ads SDK | no AdMob app id in the manifest | configure the ads plugin's `androidAppId` per variant (`admob-ads-and-consent`) |
| crash with `couldn't find "lib<name>.so"` | a library linked into JS but built for another ABI, or a dependency removed from package.json while still imported | rebuild for the emulator ABI; restore the dependency or remove the import |
| `the app process is not running` without a crash report | the app finished itself (a startup gate) or the system killed it | read `adb -s <serial> logcat -d -s ActivityManager ReactNativeJS` |

## Variant and APK checks

| Symptom | Cause | Fix |
|---|---|---|
| `check-apk` `test-code`: production contains the sentinel | Metro's cache key, or the gate is not a literal comparison | key `cacheVersion` on the public values; gate with `process.env.EXPO_PUBLIC_APP_VARIANT === 'production'` at the `require()` |
| `check-apk` `test-code`: preview lacks the sentinel | the variant was lost before Metro, or the entry is unreachable | export the variant once (`variantEnv`); check the gate's import path |
| `check-apk` `constants-variant` | the variant changed between the prebuild and Gradle | build through the script; never prebuild and build in two shells |
| `check-apk` `permissions` | a library adds a permission at merge time | block it with `android.blockedPermissions` (or the library's option), or list it in the contract and declare it (`privacy-and-store-declarations`) |
| `check-apk` `page-alignment` | a library ships native code linked for 4 KB pages | update it; Google Play requires 16 KB support for apps that target Android 15 or newer |
| `check-apk` `sdk-levels` targetSdk | `expo-build-properties` or a stale catalog | align the pins, the contract and `expo-build-properties`, then prebuild with `--clean` |

## Screenshot

| Symptom | Cause | Fix |
|---|---|---|
| `blank-screen` all white or black | a crash before the first frame, or the first screen renders nothing | read the crash buffer; open the PNG |
| `blank-screen` in the splash colour | the app never hid its splash (a startup gate waits) | `app-startup-and-bootstrap`: the splash is released when startup ends |
| `png-size` | another profile than the contract's, or a rotated tablet | create the AVD with the contract `device`, or pass `--device` / `--size` |
| notification icons or another clock in the status bar | demo mode off after a reboot | the run sends demo mode after every boot; rerun |
