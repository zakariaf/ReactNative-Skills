# The contract, the configuration and every checker rule

What each checker of this skill looks at and why, the keys of `contracts/ios-sim-build.json` and
`rn-skills.config.json` it reads, and how it runs when the repo holds several packages.

## Contents

- The contract: contracts/ios-sim-build.json
- rn-skills.config.json keys
- check-sim-setup rules
- check-sim-app rules
- check-screenshot rules
- What the checkers never scan
- When multi-package

## The contract: contracts/ios-sim-build.json

The app's own facts for simulator builds (template and schema in `templates/contracts/`). Every key is
optional; `check-sim-setup` (`contract`) refuses an unknown key, a wrong type and an unfilled
`__PLACEHOLDER__`, and `check-sim-app` stops with exit 2 on an invalid contract.

| Key | Read by | What it does | Default |
|---|---|---|---|
| `simulatorPrefix` | build script, `check-sim-setup` | simulators are `<prefix>-<purpose>`; only prefixed ones are shut down or deleted, and tooling may create no other name | the package.json name in kebab case |
| `deviceType` | build script, `check-screenshot` | the model of a newly created simulator, and the screenshot size `check-screenshot` expects | `iPhone 17 Pro Max` |
| `appId` | `check-sim-app` | the production bundle id; development and preview must be `<appId>.dev` / `<appId>.preview` | only the suffix is checked |
| `postPrebuild` | build script, `check-sim-setup` | npm scripts run from the repo root after every prebuild (an audit that reads `ios/Pods`); the preflight refuses a missing one | none |
| `usageStrings` | `check-sim-app` | `NS*UsageDescription` keys every build carries, in Info.plist and every language | keys already in Info.plist |
| `infoPlist` | `check-sim-app` | Info.plist keys with an exact value (`{ "CADisableMinimumFrameDurationOnPhone": true }` for 120 Hz on ProMotion phones) | none |
| `deploymentTarget` | `check-sim-app` | the `MinimumOSVersion` the app must carry, written like the built-in app config `ios.deploymentTarget` it mirrors: `MAJOR.MINOR` (`"18.6"`) or a major alone (`"26"`, compared as `26.0`). Set it in `app.config.ts` `ios.deploymentTarget`; the `expo-build-properties` option is deprecated since SDK 56 | only the SDK floor (16.4) |
| `usesNonExemptEncryption` | `check-sim-app` | the `ITSAppUsesNonExemptEncryption` a production build carries | only that it is set |
| `readyMarker` | build script | `{ file, contains }` in the app's data container: the ready signal | a still screen |
| `linkFlow` | build script | the Maestro sub-flow `--link` runs | `.maestro/subflows/open-link.yaml` |
| `maestroBin` | build script | the Maestro binary; set `tools/maestro/bin/maestro` when e2e-maestro's pinned install is in the repo | `maestro` on PATH |

The Xcode pin is never in the contract: it lives in `scripts/ios/toolchain.ts`, the canonical module
`ios-release-testflight` ships too, and `check-sim-app` reads it for `built-with-xcode`.

## rn-skills.config.json keys

The optional repo file the library's checkers share. This skill reads:

- the layout keys `srcDir`, `scriptsDir` and `contractsDir` (defaults `src`, `scripts`, `contracts`):
  where the sentinel search, the tooling scan and the contract live;
- `testOnlySentinels` (a list of strings): sentinels `check-sim-app` looks for in addition to the
  `export const *SENTINEL* = '...'` constants under `src/` (the same key
  `app-variants-and-environment`'s bundle check reads).

## check-sim-setup rules

`node ${CLAUDE_SKILL_DIR}/scripts/check-sim-setup.mjs [repo-root] [--app-dir <dir>]`. NOT APPLICABLE
when package.json has no `expo` dependency; exit 2 without a package.json or with a malformed contract.

| Rule | Fails when | Why |
|---|---|---|
| `contract` | the contract has an unknown key, a wrong value or an unfilled `__PLACEHOLDER__` | the build and the checkers would silently use defaults |
| `xcode-pin` | `scripts/ios/toolchain.ts` is missing, `XCODE_VERSION` is not a literal `'<major>.<minor>[.<patch>]'`, `IOS_RUNTIME` is not pinned, or the tool env lacks `DEVELOPER_DIR`, `EXPO_NO_TELEMETRY` or `CI` | an unpinned or computed Xcode builds with whatever the Mac offers |
| `scene-support` | `XCODE_VERSION` is 27 or newer, the app is on Expo SDK 57 or older, and no app config or plugin file sets `enableSceneSupport: true` and the app config does not call `addSceneSupport(` (`expo-sdk-upgrade`'s helper) | the iOS 27 SDK expects the scene life cycle: a black screen at launch |
| `sim-build-args` | `scripts/build/sim-build-plan.ts` is missing or lacks `'Release'`, `'iphonesimulator'`, `id=${`, `CODE_SIGNING_ALLOWED=NO` | Debug is not what users run; signing a simulator build touches keys for nothing |
| `variant-env` | `scripts/build/build-ios-sim.ts` sets `APP_VARIANT` / `EXPO_PUBLIC_APP_VARIANT` itself or never calls `variantEnv(` | the three moments must see one variant |
| `metro-cache-key` | `metro.config.js` is missing or its `cacheVersion` does not come from the environment | under `CI=1` the Release bundling keeps a warm cache |
| `npm-script` | `build:ios:sim` is not `node scripts/build/build-ios-sim.ts` (extra arguments allowed) or the file is missing | `expo run:ios` builds Debug on whatever Xcode `xcode-select` points at |
| `build-prereqs` | a contract `postPrebuild` script or its target file is missing | the build stops in its preflight; fix it before the first build |
| `no-xcode-select` | a tooling file or npm script runs `xcode-select -s/--switch` or `sudo` | a global switch changes every build on the Mac and needs a password |
| `sim-safety` | a simctl call targets `booted`, `all` or a literal simulator name instead of a UDID, creates a simulator named outside `<prefix>-*`, an `xcodebuild -destination` is neither `id=<udid>` nor `generic/platform=...`, or an iOS `eas build:run` has no `--simulator <udid>` | another session's simulator would be driven, wiped, deleted or installed on |
| `maestro-device` | a Maestro spawn (JS/TS), a `maestro <command>` line in a `.sh` file, an npm script or a JS/TS command string does not start with `--device <udid> --driver-host-port <port>` (or `maestroGlobalArgs`), uses `--udid`, or a fixed port | another session's simulator or driver answers |
| `adb-device` | an adb call has no `-s <serial>` before a device command (or uses `-e`/`-d`), or an emulator starts without `-avd` | the Android side of the same rule; a deliberate copy of android-emulator-build's rule, which owns it (eas-and-android.md, "Device rules on both platforms") |
| `gitignore` | `.gitignore` does not ignore `ios/`, `android/`, `build/` or `reports/` | generated folders and build output must never be committed |

Tooling files are `scripts/**/*.{ts,mts,cts,js,mjs,cjs,sh}` and every `*.sh` in the repo, plus the
`package.json` scripts; test files are left out (they assert refusals on purpose).

In JS/TS the rules read both forms: argument lists (`spawnSync('xcrun', ['simctl', 'boot', ...])`) and
a whole command line in one string or template literal that starts with `xcrun`, `simctl`, `maestro`
or `eas` (`execSync('xcrun simctl shutdown "iPhone 17 Pro"')`), which is read like a shell line.

The device rules read text, so they have limits. A device, destination or port held in a variable or
built in another module is not judged (the TypeScript helpers, `simulatorName()`,
`xcodebuildSimArgs()` and `maestroGlobalArgs()`, guard that path and their tests prove it). A command
string assembled by concatenation (`'xcrun simctl boot ' + name`) is judged only up to the first `+`,
and one that starts with anything else (`` `${XCRUN} simctl ...` ``, `'/usr/bin/xcrun simctl ...'`) is
not read as a command. A simctl argument list that puts an option before the device
(`'launch', '--console', udid`) is not judged in JS/TS. A shell command split over lines with `\` is
read line by line, so a `maestro` line whose command (`test`, ...) sits on a later line is not judged:
keep `maestro`, its global flags and the command on one line. Review hand-written device handling with
these limits in mind.

## check-sim-app rules

`node ${CLAUDE_SKILL_DIR}/scripts/check-sim-app.mjs [repo-root] --app <path.app> --variant <v>
[--app-dir <dir>] [--xcode <v>] [--platform <p>] [--min-ios <v>] [--version <x.y.z>] [--build <n>]
[--sentinel <text>]`. Exit 2 without `--app`, with an unknown variant, a folder that is not an `.app`,
a missing `--app-dir`, no Xcode pin (pass `--xcode`), or an invalid contract. The ads SDK and the
tracking library count when either the root `package.json` or the `--app-dir` one depends on them.

| Rule | Fails when |
|---|---|
| `built-with-xcode` | `DTXcode` is not the pinned Xcode's number (26.6 -> 2660) |
| `platform` | `DTPlatformName` is not `iphonesimulator` (or `--platform`) |
| `min-ios` | `MinimumOSVersion` is below 16.4, or differs from the contract `deploymentTarget` / `--min-ios` (`"26"` equals `"26.0"`) |
| `test-code` | `main.jsbundle` is missing; a production bundle holds a sentinel; a development or preview bundle lacks one; a test-only gate exists but no sentinel is known (SKIP while the app has no gate) |
| `constants-variant` | `EXConstants.bundle/app.config` is missing or unreadable, its `ios.bundleIdentifier` differs from Info.plist, or its `extra.appVariant` differs from `--variant` |
| `bundle-id` | `CFBundleIdentifier` is not a valid iOS id or not the variant's own |
| `ship-placeholder` | production: a placeholder value (`com.example.*`, Google's sample AdMob ids, the all-zero template AdMob ids, `example.com` links, `@example.com` addresses) anywhere in Info.plist or `EXConstants`; any variant: an unfilled `__PLACEHOLDER__` |
| `ad-app-id` | the app uses `react-native-google-mobile-ads` (or carries the key) and `GADApplicationIdentifier` is missing or malformed |
| `usage-strings` | a contract `usageStrings` key, an `NS*UsageDescription` the app carries, or `NSUserTrackingUsageDescription` when the app depends on `expo-tracking-transparency` (or on `react-native-google-mobile-ads` with `userTrackingUsageDescription` in the app config) is missing from Info.plist or from a language's `InfoPlist.strings` |
| `info-keys` | a contract `infoPlist` key does not have its value |
| `privacy-manifest` | `PrivacyInfo.xcprivacy` is not in the bundle |
| `ats` | `NSAppTransportSecurity.NSAllowsArbitraryLoads` is true |
| `encryption-flag` | production: `ITSAppUsesNonExemptEncryption` is not set, or differs from the contract |
| `store-test-artefacts` | production: a `*.storekit` file or a `*.xctest` bundle is inside |
| `version`, `build-number` | `--version` / `--build` given and the plist differs |

## check-screenshot rules

`node ${CLAUDE_SKILL_DIR}/scripts/check-screenshot.mjs [--device <model> | --size WxH] [--root <dir>]
[--no-banner-check] <png-or-folder>...`. Unlike the repo checkers, its positionals are PNGs or folders
of PNGs, not the repo root. The expected model is `--device`, else the contract `deviceType` under
`--root` (default: the current folder, so run it from the repo root), else iPhone 17 Pro Max.

| Rule | Fails when |
|---|---|
| `png-size` | the image is not the pixel size of the model (`--device`, else the contract `deviceType`, else iPhone 17 Pro Max, 1320 x 2868) |
| `blank-screen` | one colour covers 99% or more of the image below the status bar (8% of the height) |
| `system-banner` | 20 or more rows of the top band (4.5% to 17% of the height) are light grey from 2.5% to 97.5% of the width but not at the edges: a light notification over the app |

The banner heuristic is tuned on iOS's light notifications; an app's own full-width light bar fails its
edge test. After opening the PNG, `--no-banner-check` accepts a light band that is the app's own.

## What the checkers never scan

`check-sim-setup` walks the repo with check-lib's repo walk: `node_modules`, `ios/`, `android/`,
`build/`, `dist/`, each workspace's output folders (from package.json `workspaces`), the agent skill
folders (`.agents/`, `.claude/`, `skills/`, ...) and every folder that holds a `SKILL.md` are skipped,
because installed skills carry planted bugs in their fixtures on purpose.

## When multi-package

With npm workspaces (`apps/mobile`, `packages/*`), the app folder holds `app.config.ts`,
`metro.config.js` and the generated `ios/`; the build tooling can stay at the repo root:

- `node ${CLAUDE_SKILL_DIR}/scripts/check-sim-setup.mjs . --app-dir apps/mobile`, and
  `check-sim-app.mjs . --app-dir apps/mobile --app <path.app> --variant <v>` (it reads the app
  package's `package.json` and app config there, so the ads and tracking rules see its dependencies);
- `"build:ios:sim": "node scripts/build/build-ios-sim.ts --app-dir apps/mobile"` (the script runs the
  prebuild and xcodebuild inside the app folder and writes DerivedData to `apps/mobile/build/ios-sim/`);
- the `.gitignore` lines `ios/`, `build/` (any depth) or `apps/mobile/ios/` are both accepted;
- `sim-build-args.ts` imports the resolver from `../../src/config/app-variant.ts`; point it at the app
  package's copy (`../../apps/mobile/src/config/app-variant.ts`) when the resolver lives there.
