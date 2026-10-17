# The contract, the configuration and every checker rule

What each checker of this skill looks at and why, the keys of `contracts/android-emu-build.json` and
`rn-skills.config.json` it reads, the limits of the text rules, and how the checkers run when the repo
holds several packages.

## Contents

- The contract: contracts/android-emu-build.json
- rn-skills.config.json keys
- check-emu-setup rules
- What the device rules read, and their limits
- check-apk rules
- check-emu-screenshot rules
- What the checkers never scan
- When multi-package

## The contract: contracts/android-emu-build.json

The app's own facts for emulator builds (template and schema in `templates/contracts/`). Every key is
optional; `check-emu-setup` (`contract`) refuses an unknown key, a wrong type, an unfilled
`__PLACEHOLDER__` and a `minSdk` above the `targetSdk`, and `check-apk` stops with exit 2 on an
invalid contract.

| Key | Read by | What it does | Default |
|---|---|---|---|
| `avdPrefix` | build script, `check-emu-setup` | AVDs are `<prefix>-<purpose>`; only prefixed AVDs are created, started, stopped or deleted, and tooling may name no other | the package.json name in kebab case |
| `device` | build script, `check-emu-screenshot` | the hardware profile of a newly created AVD, and the screenshot size expected | `pixel_8` |
| `systemImage` | build script | an image other than the pinned `system-images;android-36;google_apis;<host ABI>` (one already installed, a 16 KB page image); its ABI must be the build's | the pinned image |
| `appId` | `check-apk` | the production package; development and preview must be `<appId>.dev` / `<appId>.preview` | only the suffix is checked |
| `postPrebuild` | build script, `check-emu-setup` | npm scripts run from the repo root after every prebuild (an audit that reads `android/`); the preflight refuses a missing one | none |
| `targetSdk` | `check-apk` | the `targetSdkVersion` every APK carries | React Native's catalog `targetSdk` (`node_modules/react-native/gradle/libs.versions.toml`), else `ANDROID_API` of `scripts/android/toolchain.ts`, else 36 |
| `minSdk` | `check-apk` | the `minSdkVersion` every APK carries | only the floor, 24 |
| `permissions` | `check-apk` | every permission the merged manifest may request; a name after the app's own package is written `${applicationId}.NAME` and resolves per variant; an app-own signature permission the APK declares needs no entry (`references/apk-anatomy.md`) | not checked (check-apk prints what it found) |
| `application` | `check-apk` | `<application>` attributes with an exact value, without `android:` (`{ "allowBackup": false }`) | none |
| `abi` | `check-apk` | the ABI the APK must hold libraries for | arm64-v8a or x86_64, either one |
| `readyLog` | build script | `{ tag, contains }`: the logcat line that ends the ready wait | a still screen |

The JDK and SDK pins are never in the contract: they live in `scripts/android/toolchain.ts`, where
`check-emu-setup` compares them with React Native's version catalog.

## rn-skills.config.json keys

The optional repo file the library's checkers share. This skill reads the layout keys `srcDir`,
`scriptsDir` and `contractsDir` (defaults `src`, `scripts`, `contracts`), and `testOnlySentinels` (a
list of strings `check-apk` looks for in addition to the `export const *SENTINEL* = '...'` constants
under `src/`; the same key `app-variants-and-environment`'s bundle check reads).

## check-emu-setup rules

`node ${CLAUDE_SKILL_DIR}/scripts/check-emu-setup.mjs [repo-root] [--app-dir <dir>]`. NOT APPLICABLE
when package.json has no `expo` dependency; exit 2 without a package.json, with a malformed contract
or a missing `--app-dir`.

| Rule | Fails when | Why |
|---|---|---|
| `contract` | the contract has an unknown key, a wrong value, an unfilled `__PLACEHOLDER__`, or `minSdk` above `targetSdk` | the build and the checkers would silently use defaults |
| `toolchain-pin` | `scripts/android/toolchain.ts` is missing; `JDK_MAJOR`, `ANDROID_API` or `BUILD_TOOLS_VERSION` is not a literal; `ANDROID_API` or `BUILD_TOOLS_VERSION` differs from the installed `node_modules/react-native/gradle/libs.versions.toml` (compileSdk, buildTools), or `JDK_MAJOR` from the `jvmToolchain(<n>)` of `node_modules/@react-native/gradle-plugin`; or the tool env lacks `JAVA_HOME`, `ANDROID_HOME`, `EXPO_NO_TELEMETRY` or `CI` | a stale or computed pin checks and creates the wrong SDK packages and image |
| `emu-build-args` | `scripts/build/emu-build-plan.ts` is missing, lacks `'android'`, `'--clean'`, `:app:assembleRelease`, `-PreactNativeArchitectures=` or `'--no-daemon'`, or runs a Debug, install or `run:android` task | Debug is not what users run; install tasks reach every device |
| `emu-signing` | an emulator build file names `android.injected.signing`, a `.jks` or `.keystore` file, an upload keystore or a store or key password | the emulator lane needs no secret, so it can leak none |
| `variant-env` | `scripts/build/build-android-emu.ts` sets `APP_VARIANT` / `EXPO_PUBLIC_APP_VARIANT` itself or never calls `variantEnv(` | the three moments must see one variant |
| `metro-cache-key` | `metro.config.js` is missing or its `cacheVersion` does not come from the environment | under `CI=1` the bundling task keeps a warm cache |
| `npm-script` | `build:android:emu` is not `node scripts/build/build-android-emu.ts` (extra arguments allowed) or the file is missing | `expo run:android` builds Debug on whatever device it picks |
| `build-prereqs` | a contract `postPrebuild` script or its target file is missing | the build stops in its preflight; fix it before the first build |
| `adb-device` | an adb device command has no `-s <serial>` first (or an `adbArgs` helper), uses `-e`/`-d`, or `eas build:run` targets Android | another session's device answers |
| `emulator-avd` | an emulator starts without `-avd`, or a literal AVD name in `emulator -avd`, `emulator @name`, `avdmanager create/delete avd -n` is outside `<prefix>-*` | another session's emulator is started, reused or deleted |
| `shared-machine` | `adb kill-server`, `adb disconnect` without a target, `gradlew --stop`, a Gradle `install*` task, or `pkill`/`killall` of emulators, qemu, adb, Java, Gradle or Kotlin | each ends or reaches every session's devices or builds |
| `no-global-switch` | `sudo`, `jenv global`, `sdk default java`, `update-alternatives --set/--config java`, `sdkmanager --licenses` | a global switch changes every build on the machine; licences and installs are human steps |
| `gitignore` | `.gitignore` does not ignore `android/`, `build/` or `reports/` | generated folders and build output must never be committed |

Tooling files are `scripts/**/*.{ts,mts,cts,js,mjs,cjs,sh}` and every `*.sh` in the repo, plus the
`package.json` scripts; test files are left out (they assert refusals on purpose).

## What the device rules read, and their limits

This skill owns the Android device rules (`adb-device`, `emulator-avd`, `shared-machine`) and the one
adb binding helper, `adbArgs(serial, ...command)` in `scripts/android/adb-args.ts`. The iOS twin
`ios-simulator-build` keeps a copy of `adb-device` in its setup checker as a deliberate guard for
iOS-first repos (its contract reference names this skill as the owner); the two agree (the templates
here pass both), and when they differ this skill's rule is the one to follow.

In shell text (`.sh` files and npm scripts) the rules read command lines. In JS/TS they read argument
lists given to adb (after a literal `'adb'`, after a variable named like `adbPath`, `ADB` or
`ADB_PATH`, or to a runner function named `adb`), the list given to an emulator binary (its `'-avd'` and the name after it), the
`'create'`/`'delete'`, `'avd'` lists of avdmanager, a Gradle list (`'./gradlew', [...]` or
`{ file: './gradlew', args: [...] }`) naming an `install*` task, a `'pkill'`/`'killall'` list naming
emulator, qemu, adb, Java, Gradle or Kotlin, a `'--stop'` within 200 characters after the word gradle, and whole command lines in one string or template
literal that starts with `adb`, `emulator`, `avdmanager`, `sdkmanager`, `gradlew`, `eas`, `sudo`,
`pkill`, `killall` or `jenv`.

They read text, so they have limits. A serial, AVD name or argument list held in a variable or built
in another module is not judged (the TypeScript helpers `adbArgs()`, `avdName()` and `emulatorArgs()`
guard that path, and their tests prove it). A command assembled by concatenation is judged up to the
first `+`. A shell command split over lines with `\` is read line by line. An adb global option other
than `-s`, `-e` or `-d` before the command (`-H host`, `-P port`) is not read as a device selection,
so a call whose first option is `-H host` is not judged. A Gradle or pkill list is judged only when it
follows the literal command name (`spawnSync(gradlew, tasks)` with both in variables is not). Review hand-written device handling with these limits in
mind.

## check-apk rules

`node ${CLAUDE_SKILL_DIR}/scripts/check-apk.mjs [repo-root] --apk <file.apk|folder> --variant <v>
[--abi <abi>] [--target-sdk <n>] [--version <x.y.z>] [--version-code <n>] [--app-dir <dir>]
[--sentinel <text>]`. `--apk` takes an APK file, an unzipped APK folder (binary manifest) or a decoded
one (text manifest, as apktool writes it). Exit 2 without `--apk`, with an unknown variant, a file
that is not a ZIP, no `AndroidManifest.xml`, a manifest it cannot read, or an invalid contract. The
ads SDK counts when either the root `package.json` or the `--app-dir` one depends on it.

| Rule | Fails when |
|---|---|
| `embedded-bundle` | `assets/index.android.bundle` is missing (a Debug build) or is not Hermes bytecode |
| `test-code` | a production bundle holds a sentinel; a development or preview bundle lacks one; a test-only gate exists but no sentinel is known (SKIP while the app has no gate) |
| `debuggable` | `<application android:debuggable>` is true |
| `application-id` | the manifest package is not a valid Android package or not the variant's own |
| `sdk-levels` | `targetSdkVersion` is not the expected level; `minSdkVersion` is below 24 or differs from the contract |
| `constants-variant` | `assets/app.config` is missing or not JSON, its `android.package` differs from the manifest, or its `extra.appVariant` differs from `--variant` |
| `abi` | no `lib/<abi>/` for `--abi` / the contract `abi` (else for arm64-v8a or x86_64) |
| `page-alignment` | an arm64-v8a or x86_64 library has a LOAD segment aligned below 16 KB, or is stored uncompressed off a 16 KB boundary in an APK file |
| `permissions` | the merged manifest requests a permission the contract's list lacks (a note, not a problem, without a list); `${applicationId}.NAME` entries resolve against the manifest package, and an app-own signature permission (named `<package>.NAME` and declared by the APK with `protectionLevel` signature) is never flagged |
| `cleartext` | production: `<application android:usesCleartextTraffic>` is true |
| `ad-app-id` | the app uses `react-native-google-mobile-ads` (or carries the key) and `com.google.android.gms.ads.APPLICATION_ID` is missing or malformed |
| `ship-placeholder` | production: a placeholder value (`com.example.*`, Google's sample or the template AdMob ids, `example.com` links, `@example.com` addresses) in the manifest package, a meta-data value or `app.config`; any variant: an unfilled `__PLACEHOLDER__` |
| `manifest-keys` | a contract `application` attribute does not have its value |
| `signature` | an APK file has no APK Signing Block (v2 or newer) |
| `version`, `version-code` | `--version` / `--version-code` given and the manifest differs |

The checker is a smoke-build gate, not a store gate: a production emulator APK is signed with the
debug key and may hold only the emulator's ABI. `android-release-play` checks the App Bundle, its
signing certificate and every ABI before an upload.

## check-emu-screenshot rules

`node ${CLAUDE_SKILL_DIR}/scripts/check-emu-screenshot.mjs [--device <profile> | --size WxH]
[--root <dir>] <png-or-folder>...`. Unlike the repo checkers, its positionals are PNGs or folders of
PNGs; the expected profile is `--device`, else the contract `device` under `--root` (default: the
current folder, so run it from the repo root), else `pixel_8`.

| Rule | Fails when |
|---|---|
| `png-size` | the image is not the pixel size of the profile, in either orientation (screencap follows the display's rotation) |
| `blank-screen` | one colour covers 99% or more of the image between the status bar (top 4%) and the gesture bar (bottom 3%) |

A system dialog over the app ("isn't responding", a permission prompt) is not detected by pixels; the
ready signal refuses a screen whose resumed activity is not the app's, and the reviewer looks.

## What the checkers never scan

`check-emu-setup` walks the repo with check-lib's repo walk: `node_modules`, `ios/`, `android/`,
`build/`, `dist/`, each workspace's output folders (from package.json `workspaces`), the agent skill
folders (`.agents/`, `.claude/`, `skills/`, ...) and every folder that holds a `SKILL.md` are skipped,
because installed skills carry planted bugs in their fixtures on purpose. `check-apk` reads `src/` for
sentinels with the same walk.

## When multi-package

With npm workspaces (`apps/mobile`, `packages/*`), the app folder holds `app.config.ts`,
`metro.config.js` and the generated `android/`; the build tooling can stay at the repo root:

- `node ${CLAUDE_SKILL_DIR}/scripts/check-emu-setup.mjs . --app-dir apps/mobile` and
  `check-apk.mjs . --app-dir apps/mobile --apk <apk> --variant <v>` (it reads the app package's
  `package.json` too, so the ads rule sees its dependencies);
- `"build:android:emu": "node scripts/build/build-android-emu.ts --app-dir apps/mobile"` (the script
  prebuilds and runs Gradle inside the app folder and keeps the APKs in `apps/mobile/build/android-emu/`);
- the `.gitignore` lines `android/`, `build/` (any depth) or `apps/mobile/android/` are all accepted;
- `toolchain-pin` reads React Native's catalog from `apps/mobile/node_modules` first, then the root;
- `emu-build-args.ts` imports the resolver from `../../src/config/app-variant.ts`; point it at the
  app package's copy when the resolver lives there.
