# The contract and the checks

What `contracts/ios-release.json` holds, which project settings the checkers read, and every rule of both checkers with its reason. Read it when a check fails or before changing the contract.

## Contents

- The contract
- rn-skills.config.json keys
- check-release-setup rules
- check-store-artifact rules
- What the text heuristics miss
- Expected output
- When multi-package

## The contract

`templates/contracts/ios-release.json` with its schema (`ios-release.schema.json`). Only `appId` is required. The release scripts (`scripts/release/release-config.ts`, valibot) and both checkers read the same file; a key only the checkers use (`adIdsFile`) is ignored by the scripts, and an unknown key is a `release-contract` problem.

| Key | Default | What it does |
|---|---|---|
| `appId` | (required) | the production bundle id; preview builds carry `<appId>.preview` (`app-variants-and-environment`'s `variantIdentity`); never `com.example.*` |
| `appDir` | `.` | the app folder; when multi-package `apps/<app>` (tags and the commit scope take its name) |
| `releaseBranch` | `main` | the only branch releases are built from |
| `preflight` | `["verify"]` | npm scripts run before the bump; must include `verify` |
| `postPrebuild` | `[]` (template: `audit:privacy`, `audit:network`) | npm scripts run after the clean prebuild, before the archive |
| `usageStrings` | `[]` | usage-description keys every build carries in every language |
| `usesNonExemptEncryption` | (none) | the `ITSAppUsesNonExemptEncryption` answer a production build must carry |
| `forbiddenBundleStrings` | `[]` | strings (6+ characters) that must never be in `main.jsbundle`: a stand-in screen's testID, a stub route |
| `unfinishedMarkers` | `[]` | repo files whose presence means the app is not finished |
| `adIdsFile` | `src/config/admob-ids.ts` | the app's own AdMob ids: scanned for placeholders, and read by a production/off rehearsal |
| `productionAdsMode` | `live` | the `ADS_MODE` the store build ships with: `live`, or `off` for an app that ships without ads. `release:ios` resolves it once (`releaseAdsMode`: `--ads`, else `off` for a production build when this is `off`, else the app's own default) and exports that `ADS_MODE` to the build and expects it in its gate; `check-store-artifact` prefers the build's own `extra.adsMode` and fails a mode the variant never carries (live in preview, test in production), and a production/off rehearsal reads `adIdsFile` only when it is `live` |
| `whatToTest` | `{ always: [], whenChanged: [] }` | tester checks: lines always listed, and `{ paths, line }` listed when a file under a path prefix changed (and on the first build) |

The Xcode pin is `XCODE_VERSION` in `scripts/ios/toolchain.ts` (owned by `ios-simulator-build`) and the build number is `IOS_BUILD_NUMBER` in `app.config.ts`; neither is duplicated in the contract.

## rn-skills.config.json keys

Both checkers resolve folders through check-lib's `resolveLayout` (`srcDir`, `scriptsDir`, `contractsDir`, `configDir`), so a repo that moved `src/`, `scripts/` or `contracts/` sets those keys once. `check-store-artifact` also reads `testOnlySentinels` (a list of strings only test-only code contains), added to the exported `*SENTINEL*` constants it finds under `srcDir` (the same discovery `ios-simulator-build` uses); `release:ios` reads the same key and the same `srcDir` (plus `<appDir>/src`), so the pipeline and the checker look for the same sentinels in the same folders.

## check-release-setup rules

`NOT APPLICABLE` when the repo has no local lane (no `release:ios` script and no `scripts/release/`): EAS is the default lane, and the gate still runs on every `.ipa`. No `package.json` is bad input (exit 2).

| Rule | Fails when | Why |
|---|---|---|
| `release-files` | a `scripts/release/*.ts` or `scripts/asc/*.ts` module, the Xcode pin or `app-variant.ts` is missing | the pipeline imports each of them; the message names the template that brings it |
| `export-options` | an ExportOptions key differs from the template (method, destination, signingStyle, manageAppVersionAndBuildNumber, uploadSymbols, testFlightInternalTestingOnly per variant) | `app-store` is deprecated, `destination upload` would bypass the gate, Xcode would rewrite build numbers, and a production build must not be internal-only (nor a preview build external) |
| `release-contract` | the contract is missing, a key is invalid or unknown, a template token is left, `appId` is not a real iOS id, `preflight` lacks `verify` | the gate and the preflight read the app's facts only from here |
| `version-source` | not exactly one `const IOS_BUILD_NUMBER = <int>;` (or it is unused, or below 1), a literal `buildNumber:` beside it, not exactly one literal X.Y.Z version, or `eas.json` counting build numbers remotely (`appVersionSource: "remote"`) | one counter for the number; a second counter collides (ITMS-90189). One lane per app record: EAS means remote versions (`eas-build-and-submit`), the local lane means `IOS_BUILD_NUMBER` |
| `team-id` | `app.config.ts` sets no `ios.appleTeamId` | prebuild writes `DEVELOPMENT_TEAM` from it; without it the signed archive fails |
| `ship-placeholder` | `app.config.ts` or the ad ids file holds a template value (`com.example.*`, `example.com` links, template AdMob ids, `__TOKENS__`); Google's sample ids in `app.config.ts` are allowed (testing variants use them) | the release must never start with a value only the developer can supply |
| `npm-script` | `release:ios` is not exactly `node scripts/release/release-ios.ts` | one entry point, so every release runs the same steps |
| `release-prereqs` | a contract `preflight` or `postPrebuild` script is missing from `package.json` | the release would stop halfway, or someone would drop the step |
| `api-key-signing` | `release-options.ts` lacks `-allowProvisioningUpdates` or a `-authenticationKey*` flag, or any script handles a `.p12` or runs `security import` | one signing method; no signing files on disk |
| `upload-wait` | the upload does not pass `--wait`, or nothing reads `processingState` | an upload is done only at `VALID` |
| `key-read` | any script other than `scripts/asc/asc-credentials.ts` reads the key (an fs call, exec arguments such as `openssl ... -in <keyFile>`, or a shell command such as `cat .../AuthKey_*.p8`) whose argument names it: a key path variable (`keyPath`, `keyFile`, `ascKeyPath`), `AuthKey_`/`ApiKey_`/`.p8`, or the `ASC_KEY_PATH`/`API_PRIVATE_KEYS_DIR` environment variables | one reader, into memory |
| `token-printed` | a `console.*` call whose text names a token, jwt, privateKeyPem, authorization, Bearer or headers | tokens are secrets, and request headers carry the `Authorization: Bearer` token |
| `key-material` | a `.p8`/`.p12`/`.mobileprovision`/`AuthKey_*`/`ApiKey_*` file or private key text anywhere in the repo (installed skills under `.agents/`, `.claude/`, `skills/`, `node_modules` and generated folders are not scanned) | a committed key is a leaked key |
| `wall-clock` | `scripts/clock/system-clock.ts` does not export `nowEpochSeconds` | the token is signed with the current time, read in one place |
| `gitignore-secrets` | `.gitignore` lacks `*.p8`, `AuthKey_*`, `ApiKey_*`, `*.p12`, `*.mobileprovision`, `*.xcarchive` or `*.ipa` | keys and builds never get staged |
| `claude-deny` | `.claude/settings.json` does not deny reading the key folder and signing files | defence in depth for the agent's own tools |
| `no-xcode-select` | a script runs `xcode-select -s/--switch` or `sudo` | Xcode is selected per process; sudo steps are human |
| `unfinished-marker` | a contract `unfinishedMarkers` file exists | unfinished work never ships |

## check-store-artifact rules

A ship gate: no SKIP and no NOT APPLICABLE. Bad input (exit 2): no `--ipa`/`--app`, a variant other than preview or production, an ads mode that does not fit the variant, no version or build, no bundle id (`--app-id` or the contract), no Xcode pin (`--xcode` or the toolchain), an invalid contract, a production/off rehearsal without the ad ids file.

| Rule | Variants | Fails when |
|---|---|---|
| `identity` | both | `CFBundleShortVersionString`, `CFBundleVersion`, `DTXcode` (26.6 -> 2660) or `DTPlatformName iphoneos` differ from the release |
| `bundle-id` | both | `CFBundleIdentifier` is a placeholder or not the variant's own (`<appId>`, `<appId>.preview`) |
| `constants` | both | `EXConstants.bundle/app.config` is missing, or its `ios.bundleIdentifier`, `extra.appVariant` or `extra.adsMode` disagrees: a variable was lost between prebuild and archive |
| `get-task-allow` | both | the app is unsigned, or its entitlements grant `get-task-allow`; with `--rehearsal` an app without a signature is the one SKIP line |
| `ad-app-id` | both, with the ads SDK | `GADApplicationIdentifier` is missing (the SDK stops the app at launch), not Google's sample in a test/off build, or not an AdMob id in a live build |
| `ship-placeholder` | production (tokens: both) | a placeholder value in Info.plist or EXConstants (the ad app id in a live build included); a production/off rehearsal also reports placeholder ad ids in the ad ids file |
| `usage-strings` | both | a contract key, the tracking key (when the app can ask for tracking) or any carried `NS*UsageDescription` is missing in Info.plist or a language's `InfoPlist.strings` (the development region falls back to Info.plist) |
| `test-code` | both | `main.jsbundle` is missing; a sentinel is in a production bundle or missing from a preview bundle; a test-only gate exists without a known sentinel (`release:ios` stops on the same gap before the bump). An app with neither prints a note |
| `forbidden-string` | both | a contract `forbiddenBundleStrings` string is in `main.jsbundle` |
| `unfinished-marker` | both | a contract `unfinishedMarkers` file exists in the repo the build came from |
| `privacy-manifest` | both | `PrivacyInfo.xcprivacy` is missing (App Store Connect checks it on every upload) |
| `ats` | both | `NSAllowsArbitraryLoads` is true |
| `dev-client-keys` | both | `NSBonjourServices` holds `_expo._tcp` or `NSLocalNetworkUsageDescription` is the dev launcher's text: a Release archive strips both, so their presence means a Debug archive or a removed build phase (verified against expo-dev-launcher 57 on 2026-10-10) |
| `encryption-flag` | production | `ITSAppUsesNonExemptEncryption` is unset (App Store Connect then asks for every build) or differs from the contract |
| `test-artefacts` | production | a `*.storekit` or `*.xctest` is inside the bundle |

## What the text heuristics miss

`key-read`, `token-printed`, `api-key-signing` and `no-xcode-select` read the source text of `scripts/` (comments masked); they do not follow values. They catch the shapes that leak in practice, and they are defence in depth: rule 2 of the skill (never open, print or log a key or token) is the guard, and a reviewer reads every new script under `scripts/asc/` and `scripts/release/`. Known misses, each a reason to keep credentials code small and in one file:

- a value renamed on the way (`const h = authHeaders(); console.log(h)`, `const p = keyPath; readFileSync(p)`);
- output that is not `console.*` (`process.stdout.write`, a logger wrapper, writing a file);
- a key path assembled from parts that name nothing (`join(home, dir, name)`);
- a `console.*` call whose text names the words in another sense (`console.log('tokens left', n)`) is a false alarm: rename the variable rather than weaken the rule.

`version-source` is a house prescription, not a technical limit: the pipeline reads the version through `expo config`, so `version: pkg.version` would build. The rule asks for one literal `X.Y.Z` in `app.config.ts` (`version: '1.4.0'` or `const APP_VERSION = '1.4.0'`) because the agent raises it in one known place, a reviewer and a checker read it without evaluating the config, and `eas-build-and-submit` prescribes the same literal. A repo that keeps the version in `package.json` moves it into `app.config.ts`.

## Expected output

- A clean local-lane repo: `check-release-setup: 1 repo checked, 0 problems`, `RESULT: PASS`. An EAS-only repo: `NOT APPLICABLE: the repo has no local iOS release lane ...`.
- A clean export: `check-store-artifact: 1 production build checked, 0 problems`, `RESULT: PASS`, and no SKIP line. An app without a test-only gate also prints the note `test-code: the app has no test-only gate and no sentinel, ...`.
- A keyless rehearsal: `REHEARSAL: not a release gate ...` first, then `SKIP <app> [get-task-allow] REHEARSAL: the app has no signature ...`; never cited as release evidence.

## When multi-package

With npm workspaces the app lives in `apps/<app>`: set the contract's `appDir`, run the release from the repo root, and run the gate with the repo root as its positional argument (it reads `package.json` of both the root and `appDir`). Tags become `<app>/v1.4.0+ios.14` and the release commit `chore(<app>): build 14`; `git-commits-and-reporting`'s tag check reads the workspace folders. Scripts stay at the root `scripts/` (shared tooling); `check-release-setup` reads `app.config.ts` in `appDir`. The gate looks for test-only sentinels and the test-only gate under `srcDir` and under `<appDir>/src` (so `apps/mobile/src/test-only.ts` counts without an `rn-skills.config.json`), and `release:ios` looks in the same two folders.
