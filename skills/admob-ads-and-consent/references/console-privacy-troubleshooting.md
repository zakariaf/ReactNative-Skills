# AdMob console steps, privacy facts, the smoke test and troubleshooting

## Contents

- AdMob console: the developer's steps
- Privacy facts the ads bring (App Store and Google Play)
- The ads smoke test (by hand, iOS and Android)
- Jest root mocks
- Troubleshooting by error phase and reason
- Common problems

## AdMob console: the developer's steps

These are human steps in the developer's own Google account. Explain in plain words what to click, ask,
and wait for the result; never guess an ID, never publish anything yourself.

1. **Account (once).** Create the AdMob account; complete the payments and tax profile; add the
   developer website (the same domain as the privacy policy).
2. **Apps and ad units, per platform.** Apps -> Add app -> iOS, then again for Android ("not published
   yet"; link the store listings later). For each, create three ad units: Banner (adaptive),
   Interstitial, Rewarded (any reward amount: the app ignores it; server-side verification off). The
   developer gives the two app IDs and the six unit IDs; write them into `src/config/admob-ids.ts`.
3. **Privacy & messaging.** Create and publish the "European regulations" (GDPR/TCF) message with the
   privacy-policy URL and the app's languages; optionally the "US state regulations" message. Do not
   publish an "IDFA explainer" message: the app asks Apple's prompt itself, right after Google's form,
   and a published explainer would make UMP run a second ATT flow. Without a published GDPR message,
   users in the EEA see no form and `canRequestAds` stays false.
4. **Blocking controls.** Block the sensitive categories the app does not want (gambling and betting at
   least; also dating, alcohol, get-rich-quick for most general apps). Set the maximum ad content rating
   to the one in contracts/ads.json (`PG` by default; `G` for a child-directed app). There is no client
   API for category blocking. Review the Ad review center after launch.
5. **After the first release.** Link each AdMob app to its store listing. Publish `app-ads.txt` at the
   root of the developer website with the line AdMob shows under Apps -> app-ads.txt
   (`google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0`); AdMob finds the site through the
   App Store listing's Marketing URL and Google Play's developer website, and can take a day to verify.
   On iOS the Marketing URL can only change with a new version, so the first version must carry it.
6. **Testing with live IDs** is never needed: testing builds always use test units.

## Privacy facts the ads bring (App Store and Google Play)

Owned in depth by privacy-and-store-declarations; the facts this skill must respect:

- **iOS required-reason APIs** in the Google pods (GMA 13.6.0, UMP 3.1.0): SystemBootTime `35F9.1`,
  UserDefaults `CA92.1`, DiskSpace `E174.1` (GMA); UserDefaults `CA92.1` (UMP) (read from the pods'
  manifests 2026-09-26). The pods ship their own privacy manifests; the app's aggregated report must
  list them.
- **App Privacy (App Store).** The GMA manifest (Google-Mobile-Ads-SDK 13.6.0, re-read from an SDK 57
  prebuild 2026-10-14) sets no `NSPrivacyTracking` key and no tracking domains; it declares Device ID
  (linked, used for tracking: the only tracking type); coarse location, advertising data, product
  interaction (linked, not tracking); performance, crash and other diagnostics (not linked), with
  Developer's Advertising or Marketing among the purposes of every type except crash data. UMP 3.1.0:
  coarse location, performance data, product interaction, not linked, for App Functionality. The
  answers therefore include **Device ID: collected, linked, used for tracking, by the third-party ads
  SDK**; privacy-and-store-declarations' contract (`contracts/privacy.json` `sdks`) holds these rows.
- **The app's own privacy manifest** keeps `NSPrivacyTracking: false` and lists no
  `NSPrivacyTrackingDomains`: the app's code tracks nothing, and Apple fails requests to listed domains
  for users who decline (which would stop ads for them). Only the Google pods declare tracking in their
  own manifests.
- **Data safety (Google Play).** The ads SDK collects the advertising ID, app interactions, diagnostics
  and approximate location, shared with Google for advertising; declare them, and answer "Contains ads"
  yes. The `AD_ID` permission stays declared (the SDK and the tracking plugin merge it) unless the app is
  child-directed, which blocks it.
- **ATT** (iOS): Apple's prompt comes after Google's form and before the first ad request. Declined,
  restricted or unavailable: the IDFA is all zeros, ads still serve without it, SKAdNetwork attribution
  still works. Nothing in the app depends on the answer.
- **Child-directed apps** (Kids Category): no ATT, no `NSUserTrackingUsageDescription`, and App Privacy
  answers "not used for tracking"; third-party ads only by the guideline 1.3 exception, after the
  developer's own review (consent-flow.md, "Audience").
- A privacy-policy URL is required by both stores and by AdMob.

## The ads smoke test (by hand, iOS and Android)

Six Maestro flows in `templates/maestro/ads-smoke/` (they land in `.maestro/ads-smoke/`, tag `ads-smoke`).
The folder sits outside `flows/<area>/`, which CI runs, so the app declares it in its naming contract
(naming-conventions' `flow-file` rule; check-ads `smoke-flows` checks the entry):

```json
// contracts/naming.json
"extraE2eFolders": [
  { "folder": "ads-smoke", "why": "by-hand ads smoke on ADS_MODE=test builds; CI never runs it" }
]
```

With that entry naming-conventions' `check-file-names` and `check-code-names` pass on the six flows
(verified 2026-10-10 on a copy of the reference app; every system-UI text selector carries a
`# system-ui:` comment directly above it). In a child-directed app delete the iOS ATT steps of flows 1
and 6 (`runFlow` with `platform: iOS`).
They run by hand on an `ADS_MODE=test` build of the development or preview variant, once per SDK upgrade
and before each release, never in the regular E2E run (E2E builds use `ADS_MODE=off`: e2e-maestro's
`contracts/e2e.json` `buildExtra: { "adsMode": "off" }` is compared with the build's embedded
`expo.extra.adsMode`, and its `e2e-ads-off` rule requires it while this SDK is installed). Declare the
folder in `contracts/e2e.json` `manualFolders` as `{ "folder": "ads-smoke", "why": "real UMP and ATT prompts", "startsOutside": true }` (and in
`contracts/naming.json` `extraE2eFolders`, `ads-smoke` in `tags`), so e2e-maestro's check-flows
enforces no `launchApp` and the tag; register the flows' testIDs in the screen contracts. Leave out
`requiredParams: ["geo"]`: flows 2 to 5 continue the install of flow 1 and keep its geography, so
only flows 1 and 6 set `geo=` (verified 2026-10-16 with check-flows on a copy of its fixture app:
with that key flows 2 to 5 fail `manual-folder`). They use the
test-only debug link (debug-menu-and-test-hooks: the `debug-setup.yaml` subflow and its `geo=`,
`offline=`, `onboarding=` and `open=` keys; the screen parameter is `open`, never `screen`) and the Tasks testIDs; rename the IDs to the app's own.
Use a simulator or emulator of your own (`<project>-ads-smoke`), name it in every command, and never
target a booted or shared device:

```sh
# iOS: a fresh install, Google's and Apple's answers empty, started outside Maestro (its launchApp
# would grant the ATT answer, so Apple's prompt would never show)
xcrun simctl uninstall <udid> <bundle id>; xcrun simctl install <udid> <app>
xcrun simctl privacy <udid> reset all <bundle id>; xcrun simctl launch <udid> <bundle id>
maestro --device <udid> --driver-host-port <port> test -e APP_ID=<bundle id> .maestro/ads-smoke/01-consent-eea.yaml
# Android: no ATT; a fresh install clears Google's answer
adb -s <serial> uninstall <package>; adb -s <serial> install <apk>
adb -s <serial> shell monkey -p <package> 1
maestro --device <serial> --driver-host-port <port> test -e APP_ID=<package> .maestro/ads-smoke/01-consent-eea.yaml
```

| Flow | Starts from | Proves |
|---|---|---|
| `01-consent-eea.yaml` | a fresh install | `geo=eea`: the primer first, then Google's "Consent" form, then (iOS) Apple's prompt, "Ask App Not to Track", and the test banner still loads (declining costs nothing). Apple's alert may appear while Google's form is still drawn behind it: the flow waits for the alert's button, never for the form to disappear |
| `02-relaunch.yaml` | a stop and start | no primer, form or prompt again; the banner loads |
| `03-break-interstitial.yaml` | flow 2 | the first two finished breaks show no ad (pacing: 3 before the first); the third shows Google's test interstitial ("Test mode"); the list is back after it closes |
| `04-rewarded.yaml` | flow 3 | the rewarded offer is ready, the test rewarded ad is watched to "Reward granted", and the reward is granted |
| `05-offline.yaml` | flow 4 | `offline=1`: no banner, no offer, a finished break shows no ad and no message; then `offline=0` |
| `06-geo-other.yaml` | a new fresh install | `geo=other`: Google's GDPR form never opens; on iOS Apple's prompt carries the app's purpose text (in a test build Google's sample AdMob app may show its own IDFA explainer first; the developer's app publishes none); on Android nothing is asked |

Flows 1 to 5 run in that order on one install; 6 needs its own fresh install. Never add a "show every
ad" debug switch to a setup link: it drops the pacing that flow 3 proves. If the app has no debug link
yet, run the same steps by hand and record what each showed.

## Jest root mocks

`__mocks__/react-native-google-mobile-ads.ts` and `__mocks__/expo-tracking-transparency.ts` are canonical
root mocks (unit-and-component-tests' `__mocks__/` policy): Jest applies them to every test without a
`jest.mock` call, so importing an adapter never touches native code (without the first, Jest fails with
`TurboModuleRegistry.getEnforcing(...): 'RNGoogleMobileAdsModule' could not be found`). The ads mock
lists `BannerAdSize.LARGE_ANCHORED_ADAPTIVE_BANNER` next to `ANCHORED_ADAPTIVE_BANNER` (check-ads
`root-mock`). Services above the adapters use `fake-ads.ts` and `fake-consent.ts`; an adapter test that
asserts on the SDK calls `jest.mock('<sdk>')` plus a typed `jest.requireMock(...)`. jest-expo mocks only
the tracking module's native half, whose calls answer undefined: the root mock answers `undetermined`,
then `denied` when asked. Android behaviour lives in `*.android.test.ts` (the Android Jest project),
never in an overwritten `Platform.OS`.

## Troubleshooting by error phase and reason

`AdErrorPayload` (17.2.0) carries `phase` and `reason`; the reason list is open-ended.

| `phase` | `reason` | Meaning | Action |
|---|---|---|---|
| `load` | `no-fill`, `mediation-no-fill` | no ad available (routine) | nothing; not logged; preload again later |
| `load` | `network-error`, `timeout` | offline or a slow network | nothing visible; the policy usually already blocked it |
| `load` | `invalid-request`, `invalid-argument`, `invalid-ad-string` | wrong unit ID or request | log; check `extra.adUnits`, the mode and the platform's units |
| `load` | `app-id-missing` | the app ID is missing or wrong | check the plugin options, rebuild |
| `load` | `internal-error`, `server-error` | Google side | log; retry at the next quiet moment |
| `show` | any | the ad could not be presented | log; `showInterstitial` resolves `'unavailable'`; the handler navigates on |
| any | `ad-already-used` | a fullscreen ad object was shown twice | a bug: each object is used once and destroyed after `CLOSED` |

## Common problems

| Symptom | Cause | Fix |
|---|---|---|
| Crash at launch naming `GADApplicationIdentifier` (iOS) or the AdMob app ID (Android: "Missing application ID") | plugin missing, or no app ID for that platform | `admobPluginOptions` always passes both; rebuild (EAS) or `npx expo prebuild --clean` |
| `RNGoogleMobileAdsModule could not be found` in Jest | the root mock is missing | add the canonical `__mocks__/react-native-google-mobile-ads.ts` |
| No consent form in the EEA on a real device | no published GDPR message, or a cached answer | publish the message; in a test build use the debug geography `eea` (it resets Google's answer) |
| Google's "Our app wants to stay free for you" before Apple's prompt in a test build outside the EEA | Google's sample AdMob app publishes an IDFA explainer | expected in `ADS_MODE=test` only; the developer's app publishes none |
| `canRequestAds` false forever | the user chose "Do not consent" where that blocks ads | expected; the privacy entry lets them change it |
| Apple's tracking prompt never appears on the simulator | Maestro's `launchApp` granted every permission, the app was not active, or it was answered before | launch with `xcrun simctl launch`, or `launchApp: { permissions: { all: unset } }`; reinstall to ask again |
| The app stops at the first ATT status read ("missing NSUserTrackingUsageDescription") | the tracking plugin entry or the rebuild is missing | check-ads `att-plugin`; add the entry, rebuild |
| Two tracking prompts, or UMP's explainer before Apple's | an IDFA explainer message was published in AdMob | unpublish it: the app asks ATT itself |
| Banner never appears | offline, Premium, consent not handled, `ADS_MODE=off`, onboarding not done, no fill | check the `shouldShowBanner` inputs; open the Ad Inspector (test builds only) |
| Real ads in a testing build / test ads in a store build | a wrong `ADS_MODE` pair, or an EAS Update published with another variant's environment | builds: impossible by construction (`resolveAdsMode` throws, `assertLiveIds`); updates: `readAdsExtraForBinary` turns ads off, and `eas update` runs with the channel's environment (setup-ids-and-modes.md); release checks read the built app ID (ios-release-testflight, android-release-play) |
| Ads stopped in every installed build after an update | the update was published with another variant's environment (its manifest names another app id) | republish with `eas update --channel <channel> --environment <env>` matching the builds |
| The primer, Google's form or Apple's prompt over a pushed screen | the banner slot holds the moment while mounted, not focused | pass `useIsFocused()` to `useBannerSlot` (check-ads `consent-moment`) |
| Interstitial over the screen the user just opened | the call sits in an effect, not the press handler | move it into the handler that leaves the break |
| Music keeps playing under an interstitial | media does not read the fullscreen gate, or a second lifecycle object was passed | pass the one `fullscreenAd` gate and subscribe audio to it |
| `SKAdNetworkItems` entries without `.skadnetwork` | a hand-edited list | regenerate with `scripts/ads/refresh-skadnetwork.ts` |

When filing a library issue, attach the React Native, Expo and library versions, the platform, whether
test IDs were used, and the Ad Inspector result.
