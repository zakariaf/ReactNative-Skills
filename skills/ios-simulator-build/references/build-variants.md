# Build variants on the simulator

How a simulator build becomes development, preview or production, the three moments the variant enters
the binary, the two traps that silently ship test code, and the evidence `check-sim-app` reads.

## Contents

- The three variants on a simulator
- The three moments, and why the variables stay exported for the whole run
- Trap 1: Metro's cache under CI=1
- Trap 2: test-only code behind anything but the literal comparison
- The sentinel
- What check-sim-app reads
- The back-to-back proof
- When the app has ads
- The dev client's local-network keys

## The three variants on a simulator

The variant resolver is the canonical `src/config/app-variant.ts` (`app-variants-and-environment` owns
it; this skill syncs the same bytes). A simulator build may be any of the three:

| `--variant` | Bundle id (from `variantIdentity`) | Test-only code (debug menu, test hooks, simulated clock or network) | Use it for |
|---|---|---|---|
| `preview` (the default) | `<appId>.preview` | compiled in | smoke runs, E2E flows, screenshots, the runtime network audit |
| `production` | `<appId>` | compiled out | the strip proof before a release; what the stores get |
| `development` | `<appId>.dev` | compiled in | rarely: the dev client built Release (normally it loads JS from Metro) |

Each variant installs beside the others (its own id), so a simulator can hold all three. `check-sim-app`
(`bundle-id`) checks the suffix, or the exact id when the contract gives `appId`.

## The three moments, and why the variables stay exported for the whole run

| Variable | Read by |
|---|---|
| `APP_VARIANT` | `app.config.ts` through `resolveAppVariant(process.env)` |
| `EXPO_PUBLIC_APP_VARIANT` (the same value) | Metro, which inlines it into the JS bundle |

The variant reaches the binary at three moments, each in its own process:

1. **Prebuild** evaluates `app.config.ts` and writes `Info.plist` (the bundle id, the name, the URL
   scheme of the variant).
2. **Inside `xcodebuild`**, the build phase "Generate app.config for prebuilt Constants.manifest"
   evaluates `app.config.ts` again and writes `EXConstants.bundle/app.config`, which `expo-constants`
   reads at run time.
3. **Inside `xcodebuild`**, the phase "Bundle React Native code and images" runs Metro (`expo
   export:embed`), which inlines `process.env.EXPO_PUBLIC_APP_VARIANT` and decides which modules enter
   `main.jsbundle`.

A shell that loses the variables between prebuild and `xcodebuild` silently mixes variants: a
production Info.plist with a preview bundle, or the reverse. So `build-ios-sim.ts` builds one
environment (`selectXcode()` plus `variantEnv(variant)`) and passes it to every step. Setting
`EXPO_PUBLIC_APP_VARIANT` from inside `app.config.ts` does not work either: Metro runs later, in the
Xcode build phase, with its own environment. `resolveAppVariant` throws when the two variables differ.

`check-sim-app` (`constants-variant`) compares moments 1 and 2: `ios.bundleIdentifier` in
`EXConstants.bundle/app.config` must equal Info.plist's `CFBundleIdentifier` (and `extra.appVariant`,
when an app still sets it, must equal `--variant`). Moment 3 is the sentinel.

## Trap 1: Metro's cache under CI=1

Metro inlines `EXPO_PUBLIC_*` values while transforming a file, but the values are not part of its cache
key, and the cache lives in `metro-cache` under the system temp folder, shared by every project and
build on the machine. Verified twice on Expo SDK 57 (2026-09-26 in the source project with
`expo export:embed`, the Xcode bundling command, and 2026-10-03 with `expo export`): a store build right
after a test build reused the test transforms, debug module and variant included.

React Native's Xcode script passes `--reset-cache` to the bundling step, but `@expo/cli` turns it off
when `CI` is set (`export/embed/exportEmbedAsync.js`, `@expo/cli` 57.0.27, read 2026-10-03). This build
sets `CI=1` for every step (no prompts), so it is exposed on every run. The fix is the cache key that
`app-variants-and-environment` owns:

```js
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');

const { publicEnvCacheVersion } = require('./scripts/metro/public-env-cache-version.ts');

const config = getDefaultConfig(__dirname);
config.cacheVersion = publicEnvCacheVersion(process.env);

module.exports = config;
```

`check-sim-setup` (`metro-cache-key`) fails a missing `metro.config.js` and a `cacheVersion` that does
not come from the environment; that skill's `check-variants` proves the key by behaviour.

## Trap 2: test-only code behind anything but the literal comparison

Metro folds `process.env.EXPO_PUBLIC_APP_VARIANT === 'production' ? null : require('./x')` only when the
comparison is in the same expression as the `require`. An imported `IS_TEST_BUILD` constant kept the
module in the store bundle (verified on SDK 57). The gate file (`src/test-only.ts`) and its entry belong
to `debug-menu-and-test-hooks`; the literal-comparison rule and its check to
`app-variants-and-environment`. This skill only reads the result: the sentinel in the built bundle.

## The sentinel

The test-only entry exports one string that exists nowhere else:

```ts
// in the test-only entry (debug-menu-and-test-hooks)
export const TEST_BUILD_SENTINEL = 'TASKS_TEST_BUILD_ONLY';
```

Hermes bytecode keeps ASCII string literals, so `grep -a -c TASKS_TEST_BUILD_ONLY main.jsbundle` finds
it in a built app: once or more in development and preview builds, zero times in production builds
(verified in Release simulator builds of the source project, Hermes bytecode v98). `check-sim-app`
(`test-code`) finds the sentinels by itself: `--sentinel`, else `rn-skills.config.json`
`testOnlySentinels`, else every `export const *SENTINEL* = '...'` under `src/`. Without a test-only gate
in the app it prints `SKIP src/test-only.ts [test-code] not yet created (debug-menu-and-test-hooks
creates it)`; a gate without a sentinel is a problem, because a clean production build would then prove
nothing.

## What check-sim-app reads

| Evidence | development / preview | production |
|---|---|---|
| `main.jsbundle` sentinel count | 1 or more | 0 |
| `CFBundleIdentifier` | `<appId>.dev` / `<appId>.preview` | `<appId>` |
| `EXConstants.bundle/app.config` `ios.bundleIdentifier` | equals Info.plist | equals Info.plist |
| Placeholders (`com.example.*`, Google's sample AdMob ids, the all-zero template AdMob ids `ca-app-pub-0000000000000000`, `example.com` links) | allowed (testing builds) | none |
| Unfilled `__PLACEHOLDER__` tokens | none | none |
| `ITSAppUsesNonExemptEncryption` | not checked | set (and equal to the contract) |
| `*.storekit`, `*.xctest` in the bundle | allowed | none |
| `DTXcode`, `DTPlatformName`, `MinimumOSVersion`, usage strings, privacy manifest, ATS | checked | checked |

Development and preview may carry `com.example.*` and Google's sample ad ids: they are testing builds
and never ship. A production simulator build is the rehearsal of the store build, so it may not.

## The back-to-back proof

When a change touches variants, `metro.config.js`, test-only code or the build tooling, build both in
one shell, in this order, without clearing anything:

```sh
npm run build:ios:sim -- --variant preview
node ${CLAUDE_SKILL_DIR}/scripts/check-sim-app.mjs . --app <the .app path it printed> --variant preview
npm run build:ios:sim -- --variant production
node ${CLAUDE_SKILL_DIR}/scripts/check-sim-app.mjs . --app <the .app path it printed> --variant production
```

The scheme, and so the `.app` name, comes from the app name of the variant without spaces and
punctuation, so take the `.app` path each build prints and check each build right after it. Checking a
production app as if it were preview fails (`test-code`, `bundle-id`), which shows the checker reads
the artifact.

## When the app has ads

With `react-native-google-mobile-ads` the AdMob app id is in Info.plist (`GADApplicationIdentifier`) in
every variant: the SDK stops the app at launch without one. `check-sim-app` (`ad-app-id`) requires it
and its format; `ship-placeholder` refuses Google's sample id and the all-zero template id (`ca-app-pub-0000000000000000~...`) in production. Which id and which ad units
each variant uses (test ads outside production) is `admob-ads-and-consent`'s decision.

An app that can ask for tracking authorization (it depends on `expo-tracking-transparency`, or passes
`userTrackingUsageDescription` to the AdMob plugin) needs `NSUserTrackingUsageDescription` in every
build and every language: iOS terminates an app that requests tracking without it. `check-sim-app`
(`usage-strings`) requires it then even when the contract's `usageStrings` leaves it out;
`admob-ads-and-consent` owns the consent and tracking flow and the text.

## The dev client's local-network keys

`expo-dev-client` (its `expo-dev-launcher` part, verified on 2026-10-10 by reading the SDK 57 plugin
source, `expo-dev-launcher` 57.0.20) writes `NSLocalNetworkUsageDescription` ("Expo Dev Launcher uses
the local network ...") and the `_expo._tcp` entry of `NSBonjourServices` into the generated
`ios/<App>/Info.plist`, so `npx expo prebuild` and a native snapshot show them in every variant,
production included. It also adds the Xcode build phase `[Expo Dev Launcher] Strip Local Network Keys
for Release`, which deletes both from the built product of every configuration except `Debug`; the
dev-launcher and dev-menu pods are registered for Debug configurations only (`debugOnly` in their
`expo-module.config.json`). This build is always Release, so the `.app` that `check-sim-app` reads
carries neither key, in any variant.

- Never list `NSLocalNetworkUsageDescription` in the contract's `usageStrings` for the dev client's sake:
  `usage-strings` would then fail every Release build, which is correct, because no shipped build has it.
- The strip keeps a description whose text does not contain "Expo Dev Launcher". An app that sets its
  own `NSLocalNetworkUsageDescription` (because it really browses the local network) ships that text,
  and then `usage-strings` requires it in every language, as it should.
- Re-verify after an SDK upgrade: `grep -n "Strip Local Network" node_modules/expo-dev-launcher/plugin/build/withDevLauncher.js`.

