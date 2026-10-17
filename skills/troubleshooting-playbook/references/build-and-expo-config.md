# Expo config, variants, Metro and native modules

Failures while loading app.config.ts, resolving the variant, running config plugins and prebuild, bundling with Metro, and starting native modules, on both platforms. Match the text you see in the Symptom column, or run `find-fix.mjs --text "<first error line>"`.

Status: **verified** = seen and fixed in a real run; **documented** = read in the tool's own source or docs; **open** = not settled, the fix is the current fallback. **needs a human** = a stop: send one message and wait, never work around it. Platform: blank = both. Skill = where the full procedure lives. Reviewed on 2026-10-17 against Expo SDK 57 (expo 57.0.27), React Native 0.86.3, React 19.2.3, Xcode 26.6, Android compileSdk and targetSdk 36, Jest 29.7, Maestro 2.10; re-verify the versions with `npx expo config --type public && npx expo export --platform ios --platform android`.

<!-- Generated from assets/known-failures/build.json by scripts/check-catalogue.mjs --write. Edit the JSON, not this file. -->

## Contents

- Expo config
- Variants
- Config plugins
- Build prerequisites
- Runtime
- Repo setup
- Metro
- Native modules

## Expo config

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `build-config-no-type-stripping` | Error reading Expo config: SyntaxError: Unexpected token (or ERR_UNKNOWN_FILE_EXTENSION ".ts") while loading app.config.ts or metro.config.js | Node runs without type stripping (NODE_OPTIONS=--no-strip-types, or Node older than 22.18), so app.config.ts and the .ts helpers metro.config.js requires cannot load | Use Node 22.18 or newer (projects pin 26 in .nvmrc and engines); never set --no-strip-types; an eas.json build profile that pins an older "node" breaks EAS builds the same way | verified |  | `expo-project-bootstrap` |
| `build-config-missing-ts-extension` | Error reading Expo config ... Cannot find module './src/config/app-variant' (a relative import from app.config.ts) | Node type stripping resolves files exactly as written: an extensionless relative import is not found | Write the extension in every relative import of app.config.ts ('./src/config/app-variant.ts'); the tsconfig needs allowImportingTsExtensions and erasableSyntaxOnly | verified |  | `app-variants-and-environment` |
| `build-module-typeless-warning` | Warning MODULE_TYPELESS_PACKAGE_JSON when Node runs a .ts script | An ESM .ts file loads from a folder whose nearest package.json has no "type": "module"; the app root cannot set it while metro.config.js is CommonJS | Keep scripts/package.json with {"type": "module"} for the Node-run tooling; a script that imports app files may pass --disable-warning=MODULE_TYPELESS_PACKAGE_JSON (harmless) | verified |  | `unit-and-component-tests` |

## Variants

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `build-variant-mismatch` | EXPO_PUBLIC_APP_VARIANT=<x> must equal APP_VARIANT=<y>: the JS bundle and the native app must agree | Only one of the two variant variables was exported, or they were exported with different values | Export APP_VARIANT and EXPO_PUBLIC_APP_VARIANT with the same value once for the whole run (an eas.json profile env sets both) | verified |  | `app-variants-and-environment` |
| `build-variant-unset` | APP_VARIANT and EXPO_PUBLIC_APP_VARIANT are not set: production bundles and EAS builds name their variant | A production export or an EAS build ran without a variant; the resolver refuses to guess, because a silent development default would ship test code | Set both variables in the eas.json profile env or export them for the local build; never default the resolver to production or development | documented |  | `app-variants-and-environment` |
| `build-metro-cache-variant` | A production bundle still contains test-only code, or shows the development variant, right after a development build on the same machine | Metro inlines EXPO_PUBLIC_* values at transform time but does not key its cache on them, and the cache (metro-cache in the system temp folder) is shared by every build on the machine | Set config.cacheVersion from the public values in metro.config.js (publicEnvCacheVersion(process.env)); prove it with a development build followed by a production export of the same tree. Never delete the cache instead: it hides the missing key until the next build | verified |  | `app-variants-and-environment` |
| `build-imported-constant-gate` | A test-only module is still in the production bundle although it is gated by a constant such as IS_TEST_BUILD | Metro removes a require() only when the literal process.env.EXPO_PUBLIC_APP_VARIANT comparison sits in the same expression; an imported constant, a helper call, __DEV__ or an if block does not fold | Reach test-only code only through src/test-only.ts: process.env.EXPO_PUBLIC_APP_VARIANT === 'production' ? null : require('./test-only-entry') | verified |  | `debug-menu-and-test-hooks` |
| `build-variables-lost-mid-build` | The built app reports another variant than requested (Constants.expoConfig.extra or the bundle disagree with the native identity) | The variables were set for the prebuild but not for xcodebuild or Gradle, whose bundle phase and config evaluation run the config again with their own environment | Build one environment and pass it to every step (the build scripts and EAS profiles do); never prebuild in one shell and build in another | verified |  | `app-variants-and-environment` |
| `build-variant-from-app-config` | Setting process.env.EXPO_PUBLIC_* inside app.config.ts has no effect on the JS bundle | Metro bundles later (the Xcode build phase, the Gradle bundle task or the EAS worker) in its own process and environment | Export the variable for the whole build (eas.json profile env, or the build script); app.config.ts only reads and checks it | documented |  | `app-variants-and-environment` |

## Config plugins

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `build-gad-app-id-missing` | Crash at launch mentioning GADApplicationIdentifier (iOS) or "Missing application ID" from the Google Mobile Ads SDK (Android) | The ads plugin entry is missing or has no app id for that platform, so the native manifest lacks the id the linked SDK requires at startup | Give react-native-google-mobile-ads' plugin an iosAppId and androidAppId in every variant (Google's sample ids outside production), then prebuild with --clean | verified |  | `admob-ads-and-consent` |
| `build-plugin-not-installed` | npx expo config or prebuild: Failed to resolve plugin for module "<package>" | app.config.ts lists a config plugin whose package is not installed (often added by hand before npx expo install) | npx expo install <package>, then rerun; a plugin entry and its dependency land in the same commit | verified |  | `expo-prebuild-and-config-plugins` |
| `build-no-privacy-manifest` | The prebuilt iOS app has no PrivacyInfo.xcprivacy | Expo prebuild writes the app privacy manifest only when the config declares ios.privacyManifests | Declare ios.privacyManifests from the shared PRIVACY_MANIFESTS (required-reason APIs aggregated from the pods), prebuild with --clean | verified | iOS | `privacy-and-store-declarations` |
| `build-expo-system-ui-warning` | Prebuild warns: Install expo-system-ui in your project to enable this feature | userInterfaceStyle 'automatic' needs expo-system-ui to apply the theme on Android | npx expo install expo-system-ui, so Android follows the system light or dark setting (knip then sees it through the config) | verified | Android | `design-system-structure` |
| `build-edge-to-edge-option` | Prebuild warns: `edgeToEdgeEnabled` customization is no longer available - Android 16 makes edge-to-edge mandatory | Expo SDK 54 and newer always draw edge to edge on Android; the old opt-out key does nothing | Remove android.edgeToEdgeEnabled from the app config; pad content with safe-area insets on both platforms (verified in @expo/prebuild-config of SDK 57) | documented | Android | `adaptive-layout` |

## Build prerequisites

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `build-preflight-script-missing` | A simulator or emulator build stops with "preflight failed, nothing was built": package.json has no "<script>" script, or the script runs a file that does not exist | The build contract's preflight or postPrebuild list names a script whose tooling is not in the repo yet | Add the script and the tooling it runs (the skill the contract names), then build again; never drop the entry from the contract to start the build | verified |  | `ios-simulator-build` |

## Runtime

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `build-reload-during-bundle-eval` | Release app terminates at launch: Unhandled JS Exception ... AppRegistryBinding::startSurface failed. Global was not installed | reloadAppAsync() ran during bundle evaluation (module scope of the entry or a module it imports), before the runtime was ready | Reload only from a mounted component (a press handler or an effect after the language is saved), through the direction module | verified | iOS | `rtl-and-direction` |
| `build-blank-nav-background` | The screenshot is one flat light grey (#F2F2F2) | That is the navigator's default screen background with nothing on it: the screen component rendered nothing (a stub, null, or an error swallowed into an empty view) | Build the screen or fix the error; the build skills flag such a screenshot as blank-screen | verified |  | `ios-simulator-build` |
| `build-white-screen` | The screenshot is white, black or one flat colour other than the navigator grey | The app crashed at launch or drew nothing before the first frame (a native crash, a JS error before the first render, or a splash that is never hidden) | Read the process log (iOS: xcrun simctl spawn <udid> log show --last 2m --predicate 'process == "<Executable>"'; Android: adb -s <serial> logcat -d -s ReactNativeJS AndroidRuntime); check the ads app id, the embedded bundle and the startup gate that hides the splash | verified |  | `app-startup-and-bootstrap` |
| `build-splash-never-hides` | The app stays on the splash screen (the screenshot shows only the splash colour) | The startup gate never resolved: a startup step threw or waits forever, so preventAutoHideAsync is never followed by hide | Make every startup step resolve or fail into the startup gate with a timeout, and hide the splash when startup ends (app-startup-and-bootstrap root skeleton) | documented |  | `app-startup-and-bootstrap` |

## Repo setup

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `build-expo-claude-plugin` | The Expo SDK 57 template ships .claude/settings.json enabling an Expo plugin, and its AGENTS.md says npx expo lint | Template defaults for agents; the repo has its own npm scripts and settings | Merge the project settings into that file (never overwrite it); make AGENTS.md name the repo npm scripts (npm run verify, npm run -s check:fast); the developer decides whether the plugin stays | documented |  | `expo-project-bootstrap` |
| `build-react-navigation-import` | useIsFocused, a theme or a navigator imported from @react-navigation/* misbehaves in an Expo Router app (wrong context, a second back stack) | expo-router 57 carries its own React Navigation; a direct @react-navigation/* import resolves a second copy with its own contexts | Import navigation hooks and components from expo-router only; React Navigation's static API is the fenced alternative for apps without Expo Router | documented |  | `navigation-and-routing` |
| `build-expo-doctor-script-name` | npx expo-doctor fails on a package.json script named like a binary (for example "knip") | expo-doctor treats a script named like an installed binary as a conflict | Name the script check:unused (the canonical package scripts do) | verified |  | `quality-gates` |

## Metro

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `build-metro-template-import` | Metro fails to bundle import(`./locales/${lang}`) | Metro cannot bundle a dynamic import whose path is a template string | Import each file statically (a map of the known locales or modules) | verified |  | `i18n-strings-and-catalogs` |
| `build-metro-export-error-faster` | A native build fails inside the bundle step (Xcode "Bundle React Native code and images" or Gradle createBundleReleaseJsAndAssets) with a JS error | A JS import or syntax error; the native build only shows the tail of it | Reproduce in seconds with npx expo export --platform ios (or android) and fix the first error it prints | verified |  | `ios-simulator-build` |

## Native modules

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `build-native-module-missing` | Error: Cannot find native module '<Name>' at startup (or in Jest) | The development build was made before the package was installed, or code calls requireNativeModule at import time where the module is optional | Rebuild the development build after adding a native package (Expo Go cannot load it); in your own adapters call requireOptionalNativeModule inside the factory and fall back | documented |  | `native-modules-and-new-architecture` |
| `build-podspec-in-ios-folder` | A local Turbo Module or Expo module links on Android but not on iOS | Its podspec sits in ios/ instead of the package root, where Expo autolinking looks for it (read in expo-modules-autolinking 57's iOS resolver) | Move the podspec to the package root (next to package.json), then prebuild with --clean | documented | iOS | `native-modules-and-new-architecture` |
| `build-platform-member-missing` | TypeError: <module>.<member> is not a function on one platform only | The native module does not implement that member on that platform | Check the member's platform availability in the module's types or docs, guard it with Platform.OS or a capability flag in the adapter, and test both platforms | documented |  | `native-modules-and-new-architecture` |
