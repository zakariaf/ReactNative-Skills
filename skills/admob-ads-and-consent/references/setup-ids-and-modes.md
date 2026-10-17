# Setup, IDs, ADS_MODE and SKAdNetwork

## Contents

- Versions and install
- The variant x ads-mode matrix
- Where the IDs live
- ads-config.ts: plugin options, extra and the live-ID guard
- Wiring app.config.ts
- What the config plugin writes (iOS and Android)
- Google's test IDs
- Reading the mode at runtime and building the ports
- SKAdNetwork identifiers and the refresh script
- Lint and architecture guards already in the canonical configs
- When multi-package
- Re-verify after an upgrade

## Versions and install

| Item | Version (verified 2026-10-10) | Note |
|---|---|---|
| `react-native-google-mobile-ads` | 17.2.0, exact | peers `expo >=47`, `react-native >=0.86.0`; not in the Expo SDK map; rollback target 16.5.0 |
| Google Mobile Ads iOS SDK / UMP (pods) | 13.6.0 / 3.1.0 | resolved by 17.2.0 (`sdkVersions.ios` in its package.json) |
| `play-services-ads` / UMP (Android) | 25.4.0 / 4.0.0 | minSdk 24, compileSdk 36, targetSdk 36 (`sdkVersions.android`) |
| Android backend | `classic` (the default: plugin option `androidSdk` unset) | 17.2.0 also has `nextgen` (`androidSdk: 'nextgen'`, Gradle property `RNGMA_ANDROID_BACKEND`, the next-gen ads SDK). Every adapter fact here (event names, init, the request configuration) was verified on classic only |
| `expo-tracking-transparency` | ~57.0.2 | the Expo SDK 57 map's spec; the only importer is `expo-tracking-consent-adapter.ts`; never in a child-directed app |
| `expo-application` | ~57.0.3 | the Expo SDK 57 map's spec; `Application.applicationId`, the binary's own id (the EAS Update guard below) |
| `expo-network` | ~57.0.2 | the canonical ConnectivityPort adapter (networking-and-server-state) |
| `expo-constants` | SDK 57 | reads `expo.extra` at runtime |

```sh
npm install -E react-native-google-mobile-ads@17.2.0   # npx expo install would write ^17.2.0
npx expo install expo-tracking-transparency expo-network expo-constants expo-application
# child-directed audience: leave out expo-tracking-transparency (consent-flow.md, "Audience")
npx expo prebuild --clean                              # local lane, after a plugin option change
```

Re-verify: `npm view react-native-google-mobile-ads version time --json` and
`node -e "console.log(require('react-native-google-mobile-ads/package.json').sdkVersions)"`.

Why exactly: v17 ships often (three releases in eight days around 17.2.0), so an exact pin turns every
change into a reviewed commit. A version younger than the repo's `min-release-age` fails with `ETARGET`:
wait, or take the dependency-management route (a dated exclude), never a looser range. The project uses
Continuous Native Generation: every native setting comes from the config plugin, never from an edited
`ios/` or `android/`. With EAS Build the plugin runs on every build; on the local lane rerun
`npx expo prebuild --clean` after a plugin change.

## The variant x ads-mode matrix

`resolveAdsMode(process.env, variant)` in `src/config/ads-config.ts` decides the ads of a build from
`ADS_MODE` and the canonical `APP_VARIANT` (app-variants-and-environment's `resolveAppVariant`):

| `APP_VARIANT` | `ADS_MODE` | AdMob app ID / units | Where it goes |
|---|---|---|---|
| `development` | `test` (default) | Google's sample app ID, `TestIds.*` | simulators, emulators, the dev client |
| `preview` | `test` (default) | Google's sample app ID, `TestIds.*` | internal TestFlight and Play internal testing |
| any | `off` | sample app ID in the native config, ads never initialised, consent never asked | screenshots, E2E, the runtime network audit, an app with ads switched off |
| `production` | `live` (default) | the app's own IDs (`src/config/admob-ids.ts`) | the App Store and Google Play |
| `development`, `preview` | `live` | forbidden (throws) | none: real ads in a testing build risk invalid traffic on the AdMob account |
| `production` | `test` | forbidden (throws) | none: a store build that never earns |

- Export `ADS_MODE` for the whole build run when it is not the default (an E2E or screenshot build:
  `ADS_MODE=off`). With EAS put it in the profile's `env` (an `e2e` profile that extends `preview`); on
  the local lane export it with `APP_VARIANT` and `EXPO_PUBLIC_APP_VARIANT` before `prebuild` and the
  native build, which re-evaluates `app.config.ts` while bundling.
- The app's master switch is `isAdsEnabled` in `src/config/ad-pacing.ts`; `AdsProvider` turns ads off
  when it is false or the mode is `off`.
- A test build's debug menu may turn ads off at runtime (debug-menu-and-test-hooks); it can never turn
  `live` on.
- **EAS Update re-evaluates the config.** `eas update` evaluates `app.config.ts` with the environment it
  runs in and ships the result as the update's manifest, and `Constants.expoConfig` (so `expo.extra`)
  comes from the running update's manifest (below). Publish every update with the same environment as
  the channel's builds: `eas update --channel <channel> --environment <preview|production>`, `APP_VARIANT`
  and `EXPO_PUBLIC_APP_VARIANT` as for the build, `ADS_MODE` unset (an `ADS_MODE=off` build takes no
  updates: give its profile no channel). The release-side check that an update's environment matches its
  channel belongs to the OTA and variants owners (app-variants-and-environment); the app's own guard is
  `readAdsExtraForBinary`.

## Where the IDs live

`src/config/admob-ids.ts` holds the app's IDs: iOS and Android are separate AdMob apps, each with a
banner, an interstitial and a rewarded unit. Only `app.config.ts` imports it (check-ads `ids-import`);
real unit IDs reach the app through `expo.extra.adUnits` in live builds only.

- Until the developer gives the real IDs, the template's documented-format placeholders (publisher
  `0000000000000000`) stay: every variant's config still evaluates (app-variants-and-environment's
  check-variants evaluates production too), testing builds work, check-ads prints an informational line
  about them (`... still holds the template's placeholder IDs ...`, not a problem), and the release gates
  (ios-release-testflight, android-release-play, privacy-and-store-declarations) refuse a store build
  that still carries them, or Google's sample ID in `GADApplicationIdentifier` (iOS) or
  `com.google.android.gms.ads.APPLICATION_ID` (Android). Never ship them: the AdMob app does not exist, so the build earns nothing.
- Real IDs are not secrets (every store build carries them), but the app never types an AdMob ID
  anywhere else (check-ads `hard-coded-id`, `sample-id`).
- Never invent an ID, and never copy one from another app: an ID that is not the developer's own risks
  their account and pays nobody.

## ads-config.ts: plugin options, extra and the live-ID guard

`src/config/ads-config.ts` runs in Node inside `app.config.ts` (type stripping: erasable TypeScript,
relative imports with their extension, nothing but types imported). It exports:

- `GOOGLE_SAMPLE_APP_IDS`: iOS `ca-app-pub-3940256099942544~1458002511`, Android
  `ca-app-pub-3940256099942544~3347511713`. The only place the sample publisher may appear.
- `assertLiveIds(ids)`: throws unless the app ID and the three unit IDs match AdMob's format and none is
  Google's sample (the placeholders pass: see "Where the IDs live").
- `admobPluginOptions(mode, ids, skAdNetworkItems)`: `iosAppId` and `androidAppId` are the app's own only
  in live builds (both checked), Google's samples otherwise; `delayAppMeasurementInit: true`; the
  SKAdNetwork list. The SDK is linked in every build, so both native projects always need an app ID: a
  missing `GADApplicationIdentifier` (iOS) or `com.google.android.gms.ads.APPLICATION_ID` (Android) stops
  the app at launch. It never returns `userTrackingUsageDescription`: Apple's prompt text has one writer
  (consent-flow.md, "App Tracking Transparency").
- `adsExtra(mode, ids)`: what `app.config.ts` spreads into `extra`: `{ adsMode }`, plus `adUnits: { ios,
  android }` only in live builds (checked). The key is left out otherwise: a `null` in `extra` arrives as
  `{}` at runtime.
- `resolveAdsMode(env, variant)`: the matrix above.

## Wiring app.config.ts

`examples/app-config-ads.ts` shows the lines; merge them into the app's
own config:

```ts
const variant = resolveAppVariant(process.env);
const adsMode = resolveAdsMode(process.env, variant);
// plugins:
['expo-tracking-transparency', { userTrackingPermission: sourceText(projectRoot, TRACKING_KEY) }],
['react-native-google-mobile-ads', admobPluginOptions(adsMode, ADMOB_IDS, SKADNETWORK_IDS)],
// extra:
extra: { ...config.extra, ...adsExtra(adsMode, ADMOB_IDS) },
```

The localised `NSUserTrackingUsageDescription` comes from the catalogs through the config's `locales`
(i18n-strings-and-catalogs' native locales write it next to the app name). Never write the plugin
entry with literal IDs (check-ads `plugin-entry`) and never `adUnits:` by hand (`extra-ad-units`).

## What the config plugin writes (iOS and Android)

Read in the 17.2.0 plugin source:

- iOS: `GADApplicationIdentifier` (from `iosAppId`), `GADDelayAppMeasurementInit`, `SKAdNetworkItems`
  (it only adds IDs that are missing) and, only if given, `NSUserTrackingUsageDescription` (never given
  here: the tracking plugin writes it, and Expo writes each language's `InfoPlist.strings` from the
  config's `locales`).
- Android: the manifest's `com.google.android.gms.ads.APPLICATION_ID`, `DELAY_APP_MEASUREMENT_INIT`,
  `OPTIMIZE_INITIALIZATION` and `OPTIMIZE_AD_LOADING` (the last two default to true). The Google Mobile
  Ads SDK's own manifest declares `com.google.android.gms.permission.AD_ID`, and so does the
  `expo-tracking-transparency` plugin; manifest merging keeps it unless the config blocks it
  (`android.blockedPermissions`, required for a child-directed app: consent-flow.md, "Audience").
- The plugin only warns (does not fail) when an app ID is missing, which is why `admobPluginOptions`
  always returns both.
- The Android backend: this skill assumes the plugin's `androidSdk` option is unset, so `android/build.gradle`
  builds the `classic` module (verified in source 2026-10-10: the plugin writes `RNGMA_ANDROID_BACKEND`
  into gradle.properties only when `androidSdk` is given). `nextgen` is unverified here: switching to it
  means re-verifying the ads adapter (events, init, request configuration) and rerunning the Android smoke
  flows before shipping.

## Google's test IDs

Platform-aware values of the library's `TestIds` (Google's demo units, checked 2026-10-10):

| Format | iOS test unit | Android test unit |
|---|---|---|
| Adaptive banner | `ca-app-pub-3940256099942544/2435281174` | `ca-app-pub-3940256099942544/9214589741` |
| Interstitial | `ca-app-pub-3940256099942544/4411468910` | `ca-app-pub-3940256099942544/1033173712` |
| Rewarded | `ca-app-pub-3940256099942544/1712485313` | `ca-app-pub-3940256099942544/5224354917` |

Code never types these strings: the adapter maps `units: 'test'` to `TestIds.ADAPTIVE_BANNER`,
`TestIds.INTERSTITIAL` and `TestIds.REWARDED` (`ADMOB_TEST_UNITS`). Simulators and emulators are test
devices automatically, and a phone running a test build still gets test units, so no
`testDeviceIdentifiers` are needed for ads. The library's `TestIds` module is bundled into every app
(Metro does not tree-shake), so the sample publisher is in every JS bundle inside
`node_modules/react-native-google-mobile-ads/`: release checks attribute it by module, never by a raw
bundle grep.

## Reading the mode at runtime and building the ports

`expo.extra` is not always the build's own. expo-constants resolves the running config as
`rawUpdatesManifest ?? devLauncherManifest ?? embedded app config` (read in the installed expo-constants
57 `src/Constants.ts`, 2026-10-10), and `@expo/config`'s public config keeps `extra`, `ios.bundleIdentifier`
and `android.package`. So `Constants.expoConfig.extra` is the config embedded at build time, or, while an
EAS Update runs, the `extra` that `eas update` evaluated from `app.config.ts` with its own environment. An
update published with the production environment to a preview channel would give testers live units
(what rule 4 forbids); one published from an unset or development environment to production would give
store users test ads or none.

`readAdsExtraForBinary(nativeAppId)` (`src/services/ads/read-ads-extra.ts`) is the guard: it parses
`expo.extra` with `readAdsExtra` (anything unexpected falls back to `off`, because a broken config must
never show real ads) and turns ads off when the running config's `ios.bundleIdentifier` /
`android.package` does not name the binary's own id. Every variant has its own id
(app-variants-and-environment's `variantIdentity`: `.dev`, `.preview`), and `Application.applicationId`
(expo-application) is read from the binary, so no update can change it. App code never calls
`readAdsExtra()` directly (check-ads `ads-extra-binary`). The composition root
(`examples/create-device-services.ts`) is the only importer of the adapters, and the factories decide per
mode:

```ts
const adsExtra = readAdsExtraForBinary(Application.applicationId);
ads: createAdsPort(adsExtra, {
  platform: Platform.OS === 'android' ? 'android' : 'ios',
  createAdmob: (units) => createAdmobAdsAdapter({ units, onAdError: onError }),
}),
consent: createConsentPort(adsExtra.adsMode, () =>
  createAdmobConsentAdapter({ tracking: createExpoTrackingConsentAdapter({ onError }), onError }),
),
```

`AdsRoot` passes `readAdsExtraForBinary(Application.applicationId).adsMode` to `AdsProvider`, the same
answer.

- `off`: a port that never touches an SDK (every slot empty, rewarded status `unavailable`), and a
  consent port that answers `{ canRequestAds: false, isPrivacyOptionsRequired: false }` and tracking
  `unavailable` without calling UMP or ATT. Neither adapter is even created.
- `test`: the AdMob adapter with Google's test units.
- `live`: the AdMob adapter with this platform's units from `extra.adUnits`; it throws when they are
  missing (an `app.config.ts` bug).

The app adds `ads`, `consent`, `connectivity` and `fullscreenAd` (the media gate, placements reference)
to its `Services` type, to `createDeviceServices` and to `createTestServices`
(architecture-and-boundaries' recipe for a new port).

## SKAdNetwork identifiers and the refresh script

Google publishes the SKAdNetwork IDs of itself and its third-party buyers; the plugin copies whatever
list it gets into `Info.plist`. The list is a generated TypeScript module, `src/config/skadnetwork-ids.ts`
(TypeScript, so `app.config.ts` imports it under type stripping without import attributes).

- Every entry is the full identifier, `^[a-z0-9]{10}\.skadnetwork$` (for example `cstr6suwn9.skadnetwork`).
  A list without the suffix produces an `Info.plist` Apple does not recognise; check-ads rejects it.
- On 2026-10-10 Google's AdMob iOS quick-start page listed 50 unique IDs, `cstr6suwn9.skadnetwork` first
  (the same 50, in the same order, as on 2026-09-26). The template holds that list.
- No separate `AdNetworkIdentifiers` (AdAttributionKit) key is needed: Apple states that `.skadnetwork`
  IDs work for both.
- `node scripts/ads/refresh-skadnetwork.ts` rewrites the file from
  `https://developers.google.com/admob/ios/quick-start`; `--check` exits 1 when the committed list is
  stale. It refuses to overwrite when the page yields fewer than 40 IDs or does not start with
  `cstr6suwn9.skadnetwork` (`scripts/ads/skadnetwork-list.ts`, tested). Tooling may use the network; the
  app itself calls only through its ApiClient.
- Run the `--check` before every release (wire it into the release steps), and after a refresh rebuild
  (EAS, or `npx expo prebuild --clean` on the local lane) and commit the generated file with the release.
- SKAdNetwork is iOS only; Android needs nothing similar.

## Lint and architecture guards already in the canonical configs

- `eslint.config.mjs` (typescript-and-lint-rules) bans `react-native-google-mobile-ads` and
  `expo-network` outside `src/services/*/*-adapter.ts`, and `expo-tracking-transparency` everywhere but
  `src/services/consent/*-consent-adapter.ts` (which `expo-tracking-consent-adapter.ts` matches). Do not
  add copies.
- architecture-and-boundaries lists both SDKs in `vendorSdks` (behind AdsPort and ConsentPort) and
  allows adapters to be imported only by the composition root and the test-only entry.
- check-ads is stricter than the lint: only the three named adapter files, only the SDK names each one
  needs, and only `expo-tracking-consent-adapter.ts` with only the permission calls of the tracking
  module.

## When multi-package

In a monorepo each Expo app under `apps/<app>/` carries its own ads files, IDs and contract. Run the
checkers with `--app apps/<app>` (the repo root stays the positional argument); paths inside the app
follow its own `tsconfig.json` aliases and `rn-skills.config.json`. Install the SDK in every app that
links it, at the same exact version: autolinking sees only an app's own dependencies.

## Re-verify after an upgrade

1. `npm view react-native-google-mobile-ads version time --json` (the new version must be older than the
   repo's release-age floor); read its release notes and its shipped `AGENTS.md`.
2. Rerun the Jest suites (`npx jest src/services/ads src/services/consent src/config src/hooks src/ui
   --ci --maxWorkers=2`) and the ads smoke test (console-privacy-troubleshooting.md).
3. Update the canonical root mock `__mocks__/react-native-google-mobile-ads.ts` (through unit-and-component-tests, which owns the mocks policy) and
   this skill's stand-in `scripts/lib/stubs/react-native-google-mobile-ads.mjs` when the surface, the
   event names or `TestIds` change; update `assets/admob-facts.json` (version, allowlists). Re-read how
   `show()` and a failed presentation are reported (the adapter relies on `ERROR` with phase `show`
   settling the show).
4. Rerun the privacy-manifest and Data safety review (privacy-and-store-declarations): the pods' and the
   Android SDK's declarations change with the SDK.
5. On an `expo-tracking-transparency` upgrade (it follows the Expo SDK): re-read how
   `TrackingTransparencyPermissionRequester.swift` maps restricted and denied, update the root mock and
   `scripts/lib/stubs/expo-tracking-transparency.mjs`, and rerun the ATT smoke steps.
