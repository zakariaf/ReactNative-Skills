# Build variants on an emulator

What the three variants mean for an emulator build, the three moments the variant enters an APK, the
traps that mix variants, how Release is signed here, and what `check-apk` reads to prove a variant.

## Contents

- The three variants
- The three moments
- The Metro cache trap
- The Gradle daemon and the environment
- Signing in the emulator lane
- The test-only sentinel
- What check-apk reads
- The back-to-back proof

## The three variants

`src/config/app-variant.ts` (owned by `app-variants-and-environment`) defines them; the emulator build
always builds Release:

| Variant | Package | What it is for on the emulator |
|---|---|---|
| `development` | `<appId>.dev` | the dev-client build, built Release here to prove it starts; day-to-day development uses `expo start` |
| `preview` (default) | `<appId>.preview` | the testers build: test-only code and the debug menu included; Maestro flows and screenshots run on it |
| `production` | `<appId>` | the store build: no test-only code, the real ids; prove it starts before `android-release-play` makes the App Bundle |

The testing variants carry their own package, so all three install side by side on one emulator.

## The three moments

The variant enters the APK three times, each in its own process:

1. **The prebuild** (`npx expo prebuild --platform android --clean`) evaluates `app.config.ts` with
   `APP_VARIANT` and writes `applicationId` and `namespace` into `android/app/build.gradle`
   (`'com.example.harness.preview'` in the reference app), the app name, the URL scheme's intent
   filter and every plugin's manifest entries.
2. **expo-constants' `createExpoConfig` task** runs before `preBuild` in Gradle, evaluates the app
   config again (`expo-constants/scripts/getAppConfig.js`) and writes `app.config` into the assets
   (`assets/app.config` in the APK); `Constants.expoConfig` reads it at run time. The task always
   runs (`outputs.upToDateWhen { false }`).
3. **The bundling task** (`createBundleReleaseJsAndAssets`) runs `@expo/cli export:embed`
   (`bundleCommand = "export:embed"` in the template's `android/app/build.gradle`), so Metro inlines
   `EXPO_PUBLIC_APP_VARIANT` into the Hermes bundle `assets/index.android.bundle`.

Moments 2 and 3 run inside Gradle, with the environment Gradle passes to its child processes. The
build exports `variantEnv(variant)` once on the environment of the whole run (rule 3), so all three
see the same value; `check-apk` (`constants-variant`, `application-id`, `test-code`) proves they did.

## The Metro cache trap

The build runs with `CI=1` (rule 7), and `@expo/cli` then keeps Metro's cache in `export:embed` (the
same command the iOS Release phase runs; `ios-simulator-build` verified the behaviour on 2026-10-04).
Metro's cache key does not include `EXPO_PUBLIC_*` values by default, so a production APK built right
after a preview APK can reuse the preview's transformed modules and ship the preview bundle, test hooks
included. `metro.config.js` must set `config.cacheVersion` from the public values
(`app-variants-and-environment` owns `publicEnvCacheVersion`); `check-emu-setup` (`metro-cache-key`)
checks the assignment and the back-to-back proof shows it works. Deleting `$TMPDIR/metro-cache` hides
the problem for one build.

## The Gradle daemon and the environment

A Gradle daemon is a long-lived JVM. The client hands it the caller's environment for each build, but
a daemon also outlives the run, keeps about 2 GB of memory, and is shared by every build on the
machine with the same Gradle version and JVM arguments. The emulator build passes `--no-daemon` and
`-Pkotlin.compiler.execution.strategy=out-of-process` (`gradleReleaseArgs`): each run gets a fresh JVM
started with exactly the run's environment, and nothing stays behind for another session to reuse or
to stop. The cost is the JVM warm-up, under a minute of a multi-minute build.

## Signing in the emulator lane

The prebuild template declares one signing config, `debug` (`android/app/debug.keystore`, password
`android`, alias `androiddebugkey`, public and the same in every Expo project), and the `release`
build type uses it. An emulator APK is therefore installable without any secret, and its signature
proves nothing about the store build. The upload key, Play App Signing and the App Bundle belong to
`android-release-play`; the emulator build files never name a keystore, a `.jks` file, a store
password or `android.injected.signing.*` (`check-emu-setup` `emu-signing`), so they cannot leak one.

An APK signed with another key (an EAS build) cannot replace an installed copy signed with the debug
key (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`); the run uninstalls the previous copy first, so every run is
a first launch on a fresh data folder.

## The test-only sentinel

A test-only entry exports one string that exists nowhere else
(`export const TEST_BUILD_SENTINEL = 'TASKS_TEST_BUILD_ONLY'`; `debug-menu-and-test-hooks` owns the
entry and its gate). Hermes keeps string literals as plain bytes in its bytecode, so `check-apk` finds
the sentinel in `assets/index.android.bundle`: in every development and preview APK, in no production
APK. The sentinels are found the way `app-variants-and-environment`'s bundle check finds them:
`--sentinel`, else `rn-skills.config.json` `testOnlySentinels` plus every exported `*SENTINEL*` string
constant under `src/`. While the app has no gate (`src/test-only.ts` does not exist), the rule prints
`SKIP src/test-only.ts [test-code] not yet created (debug-menu-and-test-hooks creates it)`; a gate
without a known sentinel is a problem, because the APK could not prove whether that code shipped.

## What check-apk reads

| Evidence | Where in the APK | What it proves |
|---|---|---|
| Hermes bundle | `assets/index.android.bundle` starting with the Hermes magic `c6 1f bc 03 c1 03 19 1f` | a Release build with the JS embedded and compiled |
| sentinel | inside that bundle | the bundle's variant (moment 3) |
| package | `package` of the binary `AndroidManifest.xml` | the prebuild's variant (moment 1) |
| `android.package`, `extra.appVariant` | `assets/app.config` | expo-constants' variant (moment 2) |
| `debuggable` | `<application>` | the release build type |
| SDK levels | `<uses-sdk>` | the catalog the build used |
| permissions | `<uses-permission>` of the merged manifest | what the app and every library ask for |
| native libraries | `lib/<abi>/*.so` | the emulator can install it; 16 KB pages |
| signing block | before the ZIP central directory | adb can install it |

`apk-anatomy.md` explains each part and the SDK tools that show them by hand.

## The back-to-back proof

After a change to variants, `metro.config.js`, test-only code or the build tooling, build both
variants one after the other, without clearing any cache, and check both:

```sh
npm run build:android:emu -- --variant preview --keep-emulator
npm run build:android:emu -- --variant production
node ${CLAUDE_SKILL_DIR}/scripts/check-apk.mjs . --apk build/android-emu/app-preview.apk --variant preview
node ${CLAUDE_SKILL_DIR}/scripts/check-apk.mjs . --apk build/android-emu/app-production.apk --variant production
```

The build keeps each APK as `build/android-emu/app-<variant>.apk`, because the second run's clean
prebuild deletes `android/`. The production run proves the cache key (no sentinel in its bundle) and
the variant export (its package and `app.config` agree); the preview run proves the gate is reachable.
`examples/variant-proof.md` shows a real pair.
