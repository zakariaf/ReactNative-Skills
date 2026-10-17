# Simulator build failures: symptom, cause, fix

Match the text you see (a log line, a checker rule or the screenshot) in the first column. Each row was
seen in a verified run (the source project, 2026-09-26 to 2026-10-01, or the reference app,
2026-10-04) unless it says otherwise. When the fix is a human step, stop and ask; do not work around it.

## Contents

- Environment and Xcode
- Preflight, prebuild and pods
- xcodebuild
- Variants and test-only code
- Simulator, launch and screenshot
- Configuration and TypeScript

## Environment and Xcode

| Symptom | Cause | Fix |
|---|---|---|
| `Xcode 26.6 is not installed (found: ...)` from `selectXcode()` | the pinned Xcode is missing or was renamed without its version | human step: install it as `/Applications/Xcode-26.6.app` (any `Xcode*.app` name works) and accept the licence; on a CI runner, pick the runner label whose image ships it (GitHub's `macos-26` has `/Applications/Xcode_26.6.app`, ci-pipeline-and-gates) |
| `xcodebuild -version printed "Xcode 27.0"` | `DEVELOPER_DIR` was not passed to a child process, or someone ran `xcode-select` | pass the env from `selectXcode()` to every step; never call `xcode-select` |
| `You have not agreed to the Xcode license agreements` | the licence of the selected Xcode is not accepted | human step (`sudo .../xcodebuild -license accept`); the agent never runs sudo |
| `check-sim-app` `built-with-xcode`: `DTXcode is "2700"` | built with Xcode 27 (the file named `Xcode.app`) | rebuild through `npm run build:ios:sim`; if Xcode 27 is intended, follow the move-to-Xcode-27 steps first |
| Black screen at launch after building with Xcode 27 on SDK 57 | the iOS 27 SDK expects the scene life cycle | `plugins: addSceneSupport([...])` (`expo-sdk-upgrade`'s helper) or `expo-build-properties` `ios.enableSceneSupport: true` (expo 57.0.23 or newer), or go back to Xcode 26.6 (`check-sim-setup` `scene-support`) |
| `xcrun: error: unable to find utility "simctl"` | `DEVELOPER_DIR` points at the Command Line Tools, not Xcode | use `selectXcode()`; the developer dir must end in `Xcode*.app/Contents/Developer` |

## Preflight, prebuild and pods

| Symptom | Cause | Fix |
|---|---|---|
| `build:ios:sim: preflight failed, nothing was built: "audit:privacy" runs scripts/audit/audit-privacy.ts, which does not exist` (exit 2) | a contract `postPrebuild` script points at tooling that is not installed yet | install that tooling (`privacy-and-store-declarations` ships the audit) or remove the name from `postPrebuild`; never delete the step to make the build start. `check-sim-setup` `build-prereqs` shows the same before a build |
| `preflight failed ... --link runs .maestro/subflows/open-link.yaml, which does not exist` | `--link` needs e2e-maestro's sub-flow | add the flow (`e2e-maestro`) or build without `--link` |
| `contracts/ios-sim-build.json is not valid: simulatorPrefix: must be kebab-case` | a contract value has the wrong form | fix the key; `check-sim-setup` `contract` names every invalid key |
| `pod install` fails downloading a pod | no network at prebuild time, or a CDN problem | retry once after a few minutes; never loosen a pinned version |
| `pod install` or the build fails on `@shopify/react-native-skia` with missing `libs/ios` | the package's postinstall, which fetches its prebuilt libraries, did not run (the install policy turns off lifecycle scripts unless the package is allowed) | run the package's own `install-libs.js` once (dependency-management's allow-list decides whether its script may run), then rebuild; seen by e2e-maestro on a copy of the reference app |
| `Error reading Expo config ... Cannot find module './src/config/app-variant'` | `app.config.ts` imports without the `.ts` extension | import `./src/config/app-variant.ts` (Node type stripping needs explicit extensions) |
| `SyntaxError: Unexpected token` while reading the config | Node runs without type stripping (`NODE_OPTIONS=--no-strip-types`, or Node older than 22.18) | use the pinned Node; never set `--no-strip-types` |
| `EXPO_PUBLIC_APP_VARIANT=... must equal APP_VARIANT=...` | only one of the two variables was exported | export both for the whole run (`variantEnv`); the build script does |
| `APP_VARIANT=staging is not one of development\|preview\|production` | a typo or an old variant name | use one of the three (`test`/`store` from older setups map to preview/production) |
| No `.xcworkspace` in `ios/` | the prebuild stopped early | read `build/ios-sim/logs/prebuild.log`, fix the config error, rerun |
| a step fails right after the prebuild (`build/ios-sim/logs/<script>.log`) | a post-prebuild audit found a problem (for example an undeclared required-reason API) | fix the cause in `app.config.ts` (`ios.privacyManifests`) and rebuild from a clean prebuild; never skip the audit |

## xcodebuild

| Symptom | Cause | Fix |
|---|---|---|
| `** BUILD FAILED **` with a Swift or C++ error in a pod | a native module and the SDK disagree (usually after a manual version change) | `npx expo install --check`, restore Expo's versions, clean prebuild (`dependency-management`) |
| `Signing for "<App>" requires a development team` on a simulator build | `CODE_SIGNING_ALLOWED=NO` missing | use `xcodebuildSimArgs()`; simulator builds never sign (`check-sim-setup` `sim-build-args`) |
| `... was compiled with module cache path '<another folder>/build/ios-sim/dd/...'` and `missing required module 'SwiftShims'` | the repo was copied or moved, and `build/ios-sim/dd` names the old folder | `build-ios-sim.ts` deletes it itself (`removed build/ios-sim/dd: it was built in another folder`); by hand: `rm -rf build/ios-sim/dd` |
| Build takes minutes although only JS changed | a clean prebuild plus a full build is the default | for quick iteration only, swap the JS bundle (simulator-commands reference, Speed); the evidence build is the full run |
| Disk full, or the simulator will not boot | old DerivedData, runtimes, simulators | `rm -rf build/ios-sim`, `xcrun simctl delete unavailable`; never erase simulators this repo did not create |

## Variants and test-only code

| Symptom | Cause | Fix |
|---|---|---|
| `check-sim-app` `test-code`: the production build contains the sentinel | Metro reused preview transforms (no `cacheVersion` key), test code gated by an imported constant, or a file imports the test-only entry directly | `check-sim-setup` (`metro-cache-key`) and `app-variants-and-environment`'s `check-env` name which; fix it and rebuild production |
| `check-sim-app` `test-code`: a preview build lacks the sentinel | the build ran as production (variables lost) or the entry no longer exports the sentinel | export the variant for the whole run; keep the sentinel export |
| `check-sim-app` `constants-variant` (`ios.bundleIdentifier ... but Info.plist says ...`) | the variables changed between prebuild and xcodebuild (two shells, or an `export` inside one step) | build one env object and pass it to every step |
| `check-sim-app` `bundle-id` (`expected "<appId>.preview"`) | the config does not derive the id from the variant, or a stale `ios/` from another variant | `variantIdentity()` in `app.config.ts`; clean prebuild |
| The production screenshot shows the debug menu | same as the first row | same fix; then prove it with a back-to-back preview and production build |
| `usage-strings`: `ar.lproj/InfoPlist.strings has no NSCameraUsageDescription` although the app asks for no permission | an installed module's config plugin ran automatically and wrote English default texts ("Allow <App> to access your camera"): `@expo/prebuild-config` applies its `legacyExpoPlugins` (expo-image-picker, expo-camera, expo-location, expo-media-library, ...) whenever the package is installed (seen 2026-10-04) | uninstall the module when the app does not use it; otherwise give each text in every language through the app config `locales` and prebuild with --clean |
| `ad-app-id`: `GADApplicationIdentifier is missing` | the ads config plugin is missing or has no `iosAppId` | configure `react-native-google-mobile-ads` (`admob-ads-and-consent`); clean prebuild. A missing id stops the app at launch |

## Simulator, launch and screenshot

| Symptom | Cause | Fix |
|---|---|---|
| `check-screenshot` `blank-screen`, black with a small spinner | the screenshot was taken while SpringBoard was still starting | wait for the ready signal; relaunch and screenshot again |
| `blank-screen`, `#F2F2F2 (React Navigation's default background ...)` | the navigator rendered a screen whose component draws nothing (a stub, `null`, content outside the safe area) | build the screen, rebuild, screenshot again |
| `blank-screen`, white or one colour | the app crashed at launch or drew nothing | `xcrun simctl spawn <udid> log show --last 2m --predicate 'process == "<Executable>"'`; check the JS bundle and native config |
| `check-screenshot` `system-banner`, or a light card with an app icon over the top | an iOS notification slid over the app while it was captured | dismiss it (wait, or swipe it up), screenshot again and look; `--no-banner-check` only when the light band is the app's own |
| `simctl boot` fails: `Unable to boot device due to insufficient system resources` | other sessions' simulators fill the Mac's process budget | shut down this session's own `<prefix>-*` simulators by UDID, never another session's; or reuse one of yours with `--sim <purpose>` |
| `the app was not ready after 30 s` | a JS error before the first screen, or the marker never gets its text | open the last screenshot; relaunch; in a preview build read the debug menu's error log |
| `Operation not permitted` from `xcrun simctl io <udid> screenshot /dev/null` | simctl cannot write there | write to a temporary file and delete it |
| `check-screenshot` `png-size` | the screenshot came from another model | use the `<prefix>-<purpose>` simulator of the expected model, or pass `--device` / `--size` |
| "Open in ...?" alert over the app | `simctl openurl` with a custom scheme | `--link` through the Maestro sub-flow; or launch arguments (`Settings.get`) for state |
| Status bar shows `09:41` or a charging bolt | the host's 24-hour region; `--batteryState charged` | the warm-up sets `AppleLocale en_US`; use `--batteryState discharging --batteryLevel 100` |
| `Unable to boot device in current state: Booted` | harmless when booting twice | use `xcrun simctl bootstatus <udid> -b`, which boots only if needed |
| `eas build:run` installed on another session's simulator | without `--simulator` it picks the first booted simulator (eas-cli 24.10.0 source) | always pass `--simulator <udid>` (eas-and-android reference) |

## Configuration and TypeScript

| Symptom | Cause | Fix |
|---|---|---|
| TS2741 `Property 'NODE_ENV' is missing ... ProcessEnv` in a tooling script | `expo/types` makes `NODE_ENV` required in the root program, so an env object literal is not a `ProcessEnv` | build envs by spreading `process.env` (`toolEnv(process.env, ...)`); in tests pass `{ NODE_ENV: 'test', ... }` |
| `@typescript-eslint/no-unsafe-assignment` on `env['JAVA_HOME']` | `process.env['X']` turns `any` once expo-modules-core's globals load | read it into `unknown` and narrow (`maestroEnvOf` does) |
| `[MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of .../src/config/app-variant.ts is not specified` when the build starts | the build script (ESM) imports the resolver from `src/`, whose package.json declares no `"type"`; Node re-parses it as ESM | harmless (verified 2026-10-04); `app.config.ts` prints the same during prebuild. Never add `"type": "module"` to the app's root package.json for it (Metro and Babel configs are CommonJS) |
| ESLint `Write the file extension (./x.ts)` in `scripts/` | Node type stripping needs explicit extensions | import `./sim-build-plan.ts`, not `./sim-build-plan` |
