# Ads, consent, purchases, audio, haptics and privacy

Failures with AdMob and consent (UMP, App Tracking Transparency), store purchases, audio and haptics, and privacy declarations. Match the text you see in the Symptom column, or run `find-fix.mjs --text "<first error line>"`.

Status: **verified** = seen and fixed in a real run; **documented** = read in the tool's own source or docs; **open** = not settled, the fix is the current fallback. **needs a human** = a stop: send one message and wait, never work around it. Platform: blank = both. Skill = where the full procedure lives. Reviewed on 2026-10-17 against Expo SDK 57 (expo 57.0.27), React Native 0.86.3, React 19.2.3, Xcode 26.6, Android compileSdk and targetSdk 36, Jest 29.7, Maestro 2.10; re-verify the versions with `npm ls react-native-google-mobile-ads expo-iap expo-tracking-transparency`.

<!-- Generated from assets/known-failures/services.json by scripts/check-catalogue.mjs --write. Edit the JSON, not this file. -->

## Contents

- Ads
- Consent
- Privacy
- Purchases
- Audio
- Haptics
- Config

## Ads

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `services-ads-error-codes` | Ad error handling breaks after an AdMob library update | Legacy error code strings are deprecated (removed in v18) | Branch on error.phase, then error.reason | verified (react-native-google-mobile-ads 17.x) |  | `admob-ads-and-consent` |
| `services-banner-never-shows` | The banner never appears | Offline, Premium, consent not given (canRequestAds false), ads switched off for the variant, no fill, or a container that renders nothing until the ad loads | Check the ad policy inputs in the debug menu and open the Ad Inspector in a preview build; always mount the banner slot (it keeps zero height until an ad loads) and never wrap it in a container that renders nothing until the ad is visible | documented |  | `admob-ads-and-consent` |
| `services-can-request-ads-false` | canRequestAds stays false | The user refused consent where that blocks ads | Expected; the privacy-choices row lets them change it | documented |  | `admob-ads-and-consent` |
| `services-ad-already-used` | Ad error reason ad-already-used | A full-screen ad object was shown twice | Use each ad object once and destroy it after CLOSED | documented |  | `admob-ads-and-consent` |
| `services-ad-preload-before-init` | The first interstitial or rewarded ad after launch never loads | The ad was preloaded before initialize() had resolved | Await initialize (after consent) before any preload | documented |  | `admob-ads-and-consent` |
| `services-interstitial-over-result` | An interstitial covers a result or summary screen | The call sits in the screen effect instead of the button handler that leaves the screen | Only the handlers that navigate away (Next, Continue) show an interstitial, through the ad policy | documented |  | `admob-ads-and-consent` |
| `services-banner-size-mock` | A banner test passes undefined as the size | The mock lacked BannerAdSize.LARGE_ANCHORED_ADAPTIVE_BANNER (ANCHORED_ADAPTIVE_BANNER is deprecated) | The root mock lists both sizes | verified |  | `admob-ads-and-consent` |

## Consent

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `services-ads-off-contacts-google` | An ads-off build contacts Google's consent service at launch | The consent port was built for the ads SDK directly, ignoring the ads mode | Build it through the consent factory with the ads mode; ads are enabled only when the mode is not off | verified |  | `admob-ads-and-consent` |
| `services-no-consent-form` | No consent form appears in the EEA on a real device | No published GDPR message in the AdMob console, or a cached answer | Human step: the developer publishes the message; in preview builds use the debug geography EEA plus AdsConsent.reset() | documented, needs a human |  | `admob-ads-and-consent` |
| `services-debug-geography-ships` | Consent debug settings are reachable in a production build | debugGeography and AdsConsent.reset() were not behind the test-only gate | Reach them only through test-only code; unit-test the gate | verified |  | `admob-ads-and-consent` |
| `services-consent-offline` | The consent update fails offline, and no ads show later although consent was given | The UMP request needs the network | Use canRequestAds from the earlier session when the update fails; the ad policy suppresses ads while offline | verified |  | `admob-ads-and-consent` |
| `services-att-prompt-missing` | The App Tracking Transparency prompt is missing before the first ad request, or the app has no NSUserTrackingUsageDescription | The expo-tracking-transparency plugin entry is missing, or the consent flow never asks, or code outside the consent adapter asks in the wrong order | On iOS ask in this order before any ad request: Google's form when required, then the ATT prompt while the status is not determined and the app is active. Add ['expo-tracking-transparency', { userTrackingPermission }] to the plugins and import the package only in src/services/consent/expo-tracking-consent-adapter.ts. A child-directed app has neither | documented | iOS | `admob-ads-and-consent` |
| `services-att-crash-no-usage-string` | The app crashes when it asks for tracking: "This app has crashed because it attempted to access privacy-sensitive data without a usage description ... NSUserTrackingUsageDescription" | requestTrackingPermissionsAsync ran in a build whose Info.plist has no usage string (plugin entry missing, or the native project predates it) | Add the expo-tracking-transparency plugin entry with a translated userTrackingPermission, prebuild with --clean and rebuild | verified | iOS | `admob-ads-and-consent` |
| `services-att-prompt-never-shows` | The ATT prompt never appears (requestTracking returns at once), or the tracking question shows twice with a Google explainer before it | iOS shows the prompt only while the app is active; a device that restricts tracking answers at once; the user already answered (once per install); Maestro's launchApp granted it; or an IDFA explainer message is published in the AdMob console, so UMP runs its own ATT flow first | Ask after the consent form closes and AppState is active; publish no IDFA explainer in AdMob; to see the prompt again delete the app from your own simulator and reinstall. Declined, restricted and unavailable are normal answers: ads still serve without the IDFA | documented | iOS | `admob-ads-and-consent` |
| `services-att-alert-over-form` | Apple's tracking alert appears while Google's consent form is still drawn behind it | The consent flow asks right after the form reports closed; the form's dismissal is still on screen when iOS presents the alert | Nothing to fix: the order is right. Only an ATT alert before the form is answered is a bug | verified | iOS | `admob-ads-and-consent` |
| `services-sample-idfa-explainer` | Google's "Our app wants to stay free for you" page appears before Apple's tracking prompt in a preview build outside the EEA | Preview builds use Google's sample AdMob app id, and that sample app publishes an IDFA explainer message | Expected in builds with the sample id only; never publish an explainer in the real AdMob app if the app shows its own flow | verified | iOS | `admob-ads-and-consent` |

## Privacy

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `services-gma-tracking-label` | App Review rejection risk under guideline 5.1.2(i): the ads SDK declares tracking (Device ID) in its privacy manifest | Google Mobile Ads' own manifest declares Device ID used for tracking | Ask for ATT before any ad request on iOS, answer App Privacy with Device ID collected and used for tracking by the third-party SDK, and keep the app's own manifest honest (NSPrivacyTracking false when the app's code tracks nothing) | documented | iOS | `privacy-and-store-declarations` |
| `services-static-pod-manifests` | Apple emails about missing required-reason APIs | Apple does not reliably parse the privacy manifests of static CocoaPods | Aggregate every pod manifest into ios.privacyManifests; the privacy audit fails on a gap | documented | iOS | `privacy-and-store-declarations` |
| `services-app-privacy-web-only` | The App Privacy questionnaire or the Play Data safety form cannot be filled by the agent | Both are console forms | Human step: the developer fills them from the privacy contract and the audit output | open, needs a human |  | `privacy-and-store-declarations` |
| `services-webview-sockets` | The runtime socket audit sees WebKit or system-daemon traffic | Ads render in a web view whose traffic comes from a system networking process; store traffic goes through a system daemon | Run the runtime audit with ads off; store traffic is expected | documented |  | `privacy-and-store-declarations` |
| `services-netinfo-probe` | @react-native-community/netinfo makes HTTP requests to clients3.google.com | Its default reachability check fetches generate_204 whenever the native layer gives no answer | Detect connectivity with expo-network behind the ConnectivityPort, or configure NetInfo without the reachability probe; an offline-only app declares neither | verified |  | `networking-and-server-state` |
| `services-aliased-network-global` | const send = globalThis.fetch passes lint and the bundle audit | The rules matched only direct calls of the network globals | Never alias network globals; network goes through the ApiClient port | verified |  | `privacy-and-store-declarations` |
| `services-dev-client-local-network` | NSLocalNetworkUsageDescription and NSBonjourServices appear in the generated Info.plist of every variant | expo-dev-client's plugin adds them to the generated plist | Expected on SDK 57: its build phase strips them from every non-Debug product, and the dev-launcher pods are Debug-only; check the Release .app, not the generated plist | verified | iOS | `ios-simulator-build` |
| `services-aps-environment` | aps-environment is development in a production build | expo-notifications writes aps-environment: development unless its mode says otherwise | Set the plugin's mode to production for production builds (per variant) | verified | iOS | `push-notifications` |

## Purchases

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `services-storekit-xcuitest` | SKTestSession in a UI-test runner does not control the app; products stay [] | The UI-test runner is a separate process; xcodebuild test ignores the scheme StoreKit configuration | A hosted XCTest bundle (TEST_HOST = the app) arms StoreKit testing for the bundle id; then launch the app normally | verified | iOS | `in-app-purchases` |
| `services-storekit-get-task-allow` | StoreKit testing fails silently | The app was built without the get-task-allow entitlement | Debug-only get-task-allow for the StoreKit test build; the release gate proves it absent | verified | iOS | `in-app-purchases` |
| `services-revoke-on-absence` | Premium disappears right after a purchase | A just-bought purchase is briefly missing from the current entitlements, and a foreground re-check fires after the sheet closes | Revoke only on a verified transaction with a revocation date; absence keeps the cached state | verified |  | `in-app-purchases` |
| `services-restore-sync-error` | restorePurchases throws sync-error | AppStore.sync failed or the account prompt was cancelled | Map it to a 'could not restore' state, never 'nothing to restore' | verified |  | `in-app-purchases` |
| `services-empty-products` | The price never loads, with no error | fetchProducts returns [] silently when the store cannot resolve the product id | Map an empty result to 'store unavailable'; check the product id and its state in the store console | verified |  | `in-app-purchases` |
| `services-store-price-offline` | The purchase screen shows a price while the phone is offline | Nothing linked connectivity to the store flow | Wrap the purchase port with connectivity and reload the store on reconnect | verified |  | `in-app-purchases` |
| `services-refund-after-offline-launch` | A refund is not applied after a launch that started offline: Premium stays on when the phone comes back online | The launch re-check ran offline, where a missing entitlement is not evidence, and nothing re-checked on reconnect | Re-check entitlements when connectivity returns and on every foreground while online | verified |  | `in-app-purchases` |
| `services-entitlements-offline` | Premium might be revoked or missing when entitlements are read offline | Not verified whether the current entitlements are complete offline | An error keeps the cached state; only a verified revocation removes it | open |  | `in-app-purchases` |
| `services-refund-not-pushed` | A refund in the test store does not reach the running app | The test store did not push an update; only the launch re-check saw the revocation | Handle both paths (the transaction listener and the launch check) | open |  | `in-app-purchases` |
| `services-family-sharing-irreversible` | Family Sharing for a non-consumable: should it be on? | Turning Family Sharing on in App Store Connect cannot be undone | A product decision for the developer; keep the StoreKit configuration and the console in agreement, and never turn it on without that decision | documented, needs a human | iOS | `in-app-purchases` |

## Audio

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `services-audio-other-playing` | The app's music starts over the user's own music | The audio library has no API for "other audio is playing" | Keep background music off by default (or read the session's secondaryAudioShouldBeSilencedHint in a small native module); use the ambient category | open |  | `audio-and-haptics-feedback` |
| `services-audio-voices-dropped` | The next sounds are dropped after a fast sequence of events | Cancelled cues kept their voice slots, and cues scheduled out of order got a negative time gap | Model voices as intervals on the audio clock and release them on cancel | verified |  | `audio-and-haptics-feedback` |
| `services-audio-layer-click` | A click in the middle of a synthesised sound | A layer that starts after 0 has no fade-in | Give every late-starting layer a fade-in of at least 1 ms | verified |  | `audio-and-haptics-feedback` |
| `services-audio-plugin-unwired` | No sound on a device build although the audio plugin options are defined | The plugin constant is never added to the plugins list of app.config.ts | Add the audio library's plugin entry, prebuild with --clean | documented |  | `audio-and-haptics-feedback` |
| `services-slider-percent-scale` | A volume slider sits at full and the setting holds fractions like 0.8 | The slider works in 0 to 1 while the settings row passed 0 to 100 | Convert percent and fraction in one place (the row) and save only when the whole percent changes | verified |  | `settings-and-preferences` |

## Haptics

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `services-ios-allow-haptics` | Haptics do not change with an audio session option such as iosAllowHaptics | The option only affects recording sessions | Leave it at its default with the ambient category | verified | iOS | `audio-and-haptics-feedback` |
| `services-haptics-simulator` | Haptics cannot be felt in the simulator or emulator | Simulators have no haptic engine | Check haptics on a device; the adapter test only proves the calls | documented |  | `audio-and-haptics-feedback` |
| `services-haptics-catch` | Haptics calls end in .catch(() => undefined), which looks like a swallowed error | Expo documents haptics as a no-op that can reject in Low Power Mode and similar states | Keep it as the one allowed fallback inside the haptics adapter; everywhere else errors are recorded | open |  | `audio-and-haptics-feedback` |

## Config

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `services-null-extra` | null in expo.extra arrives as {} on the device | Expo serialises extra through the manifest | Omit keys instead of writing null | verified |  | `app-variants-and-environment` |
