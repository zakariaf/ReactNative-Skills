# Consent (Google UMP), Apple's tracking prompt (ATT) and the ad gate

## Contents

- What Google and Apple require
- App Tracking Transparency
- Audience: general or child-directed
- ConsentPort and its adapter (canonical files)
- Which ConsentPort a build gets (ADS_MODE=off never calls UMP or ATT)
- The sequence: refresh, primer, form, tracking, initialize, preload
- The consent moment (AdsProvider)
- When the app calls what
- The "Ad privacy choices" entry point
- Test-only consent tools (the debug geography)
- Verified behaviour
- Tests

## What Google and Apple require

Google requires a consent message for users in the EEA, the UK and Switzerland before it serves
personalised ads, and offers messages for the US states with privacy laws. The UMP SDK shows the
message the developer publishes in the AdMob console; the app only decides when it appears:

- A consent-info update at every launch (Google: "Get started with UMP"), and the cached
  `canRequestAds` of the last session when the update fails.
- The form before the first ad request, only where it is required. Everyone else never sees it.
- Never before the user finished onboarding: the first minutes are the app, not paperwork.
- Offline or Premium: skipped; asked later, when an ad is about to load.
- A visible privacy-options entry point wherever `isPrivacyOptionsRequired` is true.

Do not set `requestNonPersonalizedAdsOnly`: the SDK reads the TCF string UMP writes (check-ads
`content-rating`).

## App Tracking Transparency

Google's ads SDK may use the IDFA (the advertising identifier), and on iOS that is tracking, so the app
asks Apple's system prompt before any ad request that could use it (App Review Guideline 5.1.2(i)):

1. the app's optional consent primer, only where Google's form is required;
2. Google's UMP form, where required;
3. Apple's ATT prompt, only while the status is not-determined (`ConsentPort.requestTracking()`), after
   the form has closed and while the app is active. Where no Google form is due, Apple's prompt appears
   on its own with the app's purpose text: no primer, no form;
4. then `ads.initialize()` and the preloads. Every ad request follows the ATT answer.

When the user declines, when the device restricts tracking (parental controls, a managed device,
"Allow Apps to Request to Track" off), or when the status cannot be read, ads still initialize and
serve, without the IDFA (Google: "If a user denies ATT, continue to request ads ... the SDK doesn't
send IDFA in the ad request"). The app never withholds a feature, a reward or Premium for the answer
and never asks twice: Apple shows the prompt once per install, and 5.1.2(i) forbids gating anything on
it.

**Android** has no prompt: the user resets or deletes the advertising ID in the system settings, the
SDK reads what is there, and `requestTracking()` answers `unavailable` without touching the tracking
module (`expo-tracking-consent-adapter.android.test.ts`). Consent through UMP works the same on both platforms.

Never asked: with `ADS_MODE=off` (every E2E, screenshot and network-audit build), in a child-directed
app (below), for Premium, offline (the moment retries once online), before onboarding is done, and over
a focused task (the prompt, like the primer, waits until an ad screen is focused).

**No IDFA explainer message in the AdMob console.** UMP can show its own explainer and then run the ATT
prompt itself. The developer leaves that message unpublished: the app's order above asks exactly once,
through `expo-tracking-transparency`, which only `expo-tracking-consent-adapter.ts` imports.

**The text.** `NSUserTrackingUsageDescription` comes from one catalog key (contracts/ads.json
`trackingTextKey`, default `permissions.tracking.usage-description`) in every language's catalog: the
`expo-tracking-transparency` plugin entry gets the source language's text (`userTrackingPermission`),
and the config's `locales` write `locales.<lang>.ios.NSUserTrackingUsageDescription` for every language
(Expo writes them to each `InfoPlist.strings` at prebuild). Without the key the package stops the app on
its first status read, so check-ads `att-plugin` requires the plugin entry, the localised writer, the
text in every catalog and the package. The AdMob plugin's own `userTrackingUsageDescription` stays
unset: one writer. Say plainly what the identifier is used for and that the app works the same either
way; never promise a reward for allowing it.

**How Expo reports the status.** `expo-tracking-transparency` 57.0.2 (`TrackingTransparencyPermissionRequester.swift`,
read 2026-10-10) maps `.authorized` to `granted`, **both `.denied` and `.restricted` to `denied`**, and
`.notDetermined` to `undetermined`; off iOS both calls answer `granted` without asking. So the adapter
returns `authorized`, `denied` (declined or restricted, the same for ads), `not-determined` (the system
closed the prompt without an answer, or the app was not active), or `unavailable` (not iOS, or the read
failed). `'restricted'` stays in `TrackingStatus` for other adapters and tests.

**Sources (checked 2026-10-10 unless noted):**

- Google, "Get started with UMP" (iOS and Android): a consent-info update at every launch,
  `loadAndShowConsentFormIfRequired` after it, `canRequestAds` before any ad request.
- Google, "IDFA explainer message" (iOS): continue to request ads after a denied ATT; the SDK sends no
  IDFA then; `NSUserTrackingUsageDescription` is required.
- react-native-google-mobile-ads, "European User Consent": a configured ATT message makes UMP run the
  ATT alert itself; otherwise the app asks ATT after consent is gathered.
- Apple, `requestTrackingAuthorization(completionHandler:)`: no prompt unless the app is active; none
  when tracking is restricted or switched off, or a request is pending.
- Apple, `NSUserTrackingUsageDescription`: required; the app crashes without it.
- Apple, `NSPrivacyTracking` / `NSPrivacyTrackingDomains`: requests to a listed domain fail while
  tracking is not granted.
- Apple, App Review Guidelines 5.1.2(i): explicit permission through the ATT APIs; nothing may
  require it.
- Apple, App Review Guidelines 1.3 (Kids Category, read 2026-10-10): no personally identifiable or
  device information to third parties; no third-party advertising, except, in limited cases,
  contextual advertising from services with publicly documented Kids Category practices that include
  human review of ad creatives.
- Expo, TrackingTransparency (SDK 57, https://docs.expo.dev/versions/v57.0.0/sdk/tracking-transparency/):
  plugin option `userTrackingPermission`; Android's `com.google.android.gms.permission.AD_ID`.

## Audience: general or child-directed

contracts/ads.json `audience` decides the request configuration the adapter sets before `initialize`
(`REQUEST_CONFIGURATION` in `admob-ads-adapter.ts`), and check-ads `content-rating` plus check-ad-behaviour
`adapter-init` hold the two in step:

| Audience | Request configuration | Also |
|---|---|---|
| `general` (default) | `maxAdContentRating: MaxAdContentRating.<maxAdContentRating>` (default PG); no `tagForChildDirectedTreatment`, no `tagForUnderAgeOfConsent`, no `ageRestrictedTreatment` | the console's maximum ad content rating matches |
| `child-directed` | `maxAdContentRating: MaxAdContentRating.G`, `tagForChildDirectedTreatment: true`, `tagForUnderAgeOfConsent: true`; no `ageRestrictedTreatment` (below) | `android.blockedPermissions: ['com.google.android.gms.permission.AD_ID']` in the app config (the SDK and the tracking plugin both declare it; Google Play's Families policy forbids sending the advertising ID from apps for children); **no ATT at all** (below) |

**Why the deprecated child tags, not `ageRestrictedTreatment`** (verified in source 2026-10-10 on
react-native-google-mobile-ads 17.2.0). `RequestConfiguration.d.ts` marks `tagForChildDirectedTreatment`
and `tagForUnderAgeOfConsent` `@deprecated Use ageRestrictedTreatment instead`, but the JS enum
`AgeRestrictedTreatment.CHILD` sends the string `"child"`, while both Android modules
(`android/src/classic/.../ReactNativeGoogleMobileAdsModule.kt` and the `nextgen` one) match only
`"CHILD"`, `"TEEN"` and `"UNSPECIFIED"`. On Android the setting is therefore dropped without an error; only
iOS (`RNGoogleMobileAdsModule.mm`, which matches `"child"`) applies it. Keep the two deprecated tags, and
leave `ageRestrictedTreatment` out in both audiences: check-ads `content-rating` flags it everywhere until
the mapping is fixed. Re-verify on every SDK upgrade: `grep -n '"CHILD"\|"child"'` in those two Kotlin
files and in `src/types/AgeRestrictedTreatment.ts`; when Android matches the enum's values, switch to
`ageRestrictedTreatment: AgeRestrictedTreatment.CHILD`, require it in the child-directed profile and
remove it from `androidDroppedRequestOptions` in `assets/admob-facts.json`.

**A child-directed app never implements ATT.** Kids Category apps may not send device information to
third parties (App Review 1.3), and App Review rejects Kids Category apps that show the ATT prompt or
carry `NSUserTrackingUsageDescription` (its review feedback, quoted on the Apple Developer Forums
thread 765797, asks such apps to remove both; observed reports, not a guideline sentence). So in this
profile:

- `expo-tracking-transparency` is not installed (`npm uninstall expo-tracking-transparency`), and its
  plugin entry, the `locales.<lang>.ios.NSUserTrackingUsageDescription` lines, the tracking catalog
  key, the root mock and `expo-tracking-consent-adapter.ts` (+ tests) are deleted;
- the composition root passes `tracking: null` to `createAdmobConsentAdapter`, so
  `ConsentPort.requestTracking()` answers `'unavailable'` without asking and `prepareAds` goes straight
  from Google's consent to `initialize`;
- App Store Connect's App Privacy answers say the data is **not used for tracking**
  (privacy-and-store-declarations);
- check-ads `att-plugin` then requires the absence of the plugin, the localised key, the package and the
  adapter, and `att-wiring` requires `tracking: null` (a bad case each way in the self-test).

Neither profile covers COPPA, GDPR-K or Google Play's Families policy by itself, and guideline 1.3 allows
third-party ads in the Kids Category only by exception (contextual ads from a network with documented
Kids Category practices and human review of creatives). A child-directed app needs the developer's own
review of those rules first (and Families-certified ad networks on Play): stop and ask before shipping
ads in it. Mixed audiences (an age gate that switches the tags per user) are out of this skill's scope;
record them as a decision before building them.

## ConsentPort and its adapter (canonical files)

`src/services/consent/` is canonical in this library (this skill owns it; the analytics and privacy
skills ship the same bytes): `consent-port.ts`, `admob-consent-adapter.ts` (+ iOS and Android tests),
`expo-tracking-consent-adapter.ts` (Apple's prompt, the only importer of `expo-tracking-transparency`;
+ iOS and Android tests; general audience only), `consent-factory.ts` (+ test), `fake-consent.ts`
(+ test). The test-only `admob-consent-debug-adapter.ts` is this skill's template.

```ts
export type ConsentInfo = { readonly canRequestAds: boolean; readonly isPrivacyOptionsRequired: boolean };
export type TrackingStatus = 'authorized' | 'denied' | 'restricted' | 'not-determined' | 'unavailable';
export type ConsentPort = {
  readonly refresh: () => Promise<ConsentInfo>; // every launch (ads enabled, no Premium)
  readonly showFormIfRequired: () => Promise<ConsentInfo>; // Google's form, where required
  readonly showPrivacyOptions: () => Promise<ConsentInfo>; // the "Ad privacy choices" entry
  readonly requestTracking: () => Promise<TrackingStatus>; // Apple's ATT prompt, after the form
};
/** The ATT half: createExpoTrackingConsentAdapter(...), or null in a child-directed app. */
export type TrackingConsent = Pick<ConsentPort, 'requestTracking'>;
```

| Port call | SDK call | On failure (offline) |
|---|---|---|
| `refresh()` | `AdsConsent.requestInfoUpdate(debugSettings)` | `AdsConsent.getConsentInfo()` (last session's answer); if that fails too, no ads |
| `showFormIfRequired()` | `AdsConsent.loadAndShowConsentFormIfRequired()` | the cached answer |
| `showPrivacyOptions()` | `AdsConsent.showPrivacyOptionsForm()` | the cached answer |
| `requestTracking()` | the `tracking` option: `getTrackingPermissionsAsync()`; while `undetermined` and once `AppState` is `active`, `requestTrackingPermissionsAsync()`; `tracking: null` answers `'unavailable'` | `'unavailable'` (logged, never a rejection); off iOS `'unavailable'` without a call |

`isPrivacyOptionsRequired` is `privacyOptionsRequirementStatus === REQUIRED`. Every failure goes to
`onError` (the error log) and is never shown; no method rejects (error-handling-typed-results: an
adapter converts at the boundary). The root mock `__mocks__/expo-tracking-transparency.ts` (jest-expo
mocks only the native module, whose calls answer undefined) lets the tracking adapter's test script the
answers.

`fake-consent.ts` (`createFakeConsent({ afterRefresh, afterForm, tracking?, trackingAnswer?, log? })`)
records every call in order (a `log` array shared with `createFakeAds` proves the order across ports),
answers the scripted ATT status (default `'unavailable'`, as with ads off), shows its "prompt" only while
the status is `'not-determined'` (then the answer, default `'denied'`, sticks) and counts the prompts.

## Which ConsentPort a build gets (ADS_MODE=off never calls UMP or ATT)

`createConsentPort(adsMode, createAdmob)` (`consent-factory.ts`) returns, for `off`, a port that never
touches an SDK and answers `{ canRequestAds: false, isPrivacyOptionsRequired: false }` and tracking
`'unavailable'`; for `test` and `live`, `createAdmob()`. The composition root writes the adapter call
inside the factory's argument, so only it imports the adapter and an `off` build never creates one:

```ts
consent: createConsentPort(adsExtra.adsMode, () =>
  createAdmobConsentAdapter({ tracking: createExpoTrackingConsentAdapter({ onError }), onError }),
),
// child-directed: createAdmobConsentAdapter({ tracking: null, onError })
```

Why: `AdsConsent.requestInfoUpdate` asks Google's servers from the app process, and `off` builds are the
ones used for screenshots, E2E and the runtime network audit, which fails on any non-loopback socket of
the app. check-ads `consent-factory` fails a `createAdmobConsentAdapter(...)` call outside
`createConsentPort(...)` (the test-only entry excepted).

## The sequence: refresh, primer, form, tracking, initialize, preload

`ad-gate.ts` is pure orchestration over the two ports:

1. `refreshConsentAtLaunch(deps, input)`: at every launch, after the first render, never awaited by it.
   Skipped for Premium or with ads disabled. Stores `canRequestAds` and the privacy flag (`onConsent`).
2. `prepareAds(deps, input)`: before the first ad is ever requested. Returns `false`, asking nothing,
   for Premium, with ads disabled, before onboarding is done, or offline. Otherwise: `consent.refresh()`
   -> `onConsent`; if that answer allows ads (consent given before, or none required here) no primer and
   no form; else `showIntro()` (the primer, resolved on Continue; at once without one) ->
   `showFormIfRequired()` -> `onConsent`. Then, only if `canRequestAds`: `requestTracking()` (whatever
   the answer, the gate goes on) -> `ads.initialize()` (a failure is a value: return `false`, the
   adapter recorded it) -> `preloadInterstitial()` -> `preloadRewarded()` -> `true`.

`ads.initialize()` calls `mobileAds().setRequestConfiguration(REQUEST_CONFIGURATION)` and then
`mobileAds().initialize()`, once: an overlapping call shares the running one, and a failed one is
forgotten so the next call tries again. The library warns that ads may preload at initialisation, so
consent always comes first: nothing initialises or loads before `canRequestAds`, and no ad loads before
`initialize` succeeded.

## The consent moment (AdsProvider)

Three pieces run it:

- `consent-moment-flow.ts` (`createConsentMomentFlow`): plain data, tested without React. It counts the
  focused ad screens (`requestAdMoment()` returns the function that releases one), keeps the gate's
  latest facts (`updateInput`), runs `prepareAds` once per session while an ad screen holds the moment,
  and shows the primer only then: the primer never covers a focused task; if the user opens a task
  before Google answers, it waits for the next visit. The ATT request follows the same rule. Once the user has
  seen the moment it does not return this session, whatever the answer; a closed gate (offline,
  onboarding) retries when a fact changes, also when the facts changed while the gate was deciding
  (onboarding ends in the same render that opens the list, and the banner slot's effect runs first).
  The snapshot publishes a refusal at once but `canRequestAds: true` only after `prepareAds` finished
  (consent, the ATT answer, a successful `initialize`), so no banner requests an ad while Apple's
  prompt is up (check-ad-behaviour proves it).
- `use-consent-moment.ts` and `ads-provider.tsx` (`AdsProvider`): the hook creates the flow once, feeds
  it (isPremium, isAdsEnabled = pacing switch and mode, isOnboardingDone, isOnline from the
  ConnectivityPort), refreshes once per launch, and hands down `{ ads, connectivity, flow, config }`
  through `AdsContext` (dependencies only, never state). The component draws the app's primer full
  screen over the app while the flow asks for it; the app behind is hidden from VoiceOver
  (`accessibilityViewIsModal`) and TalkBack (`importantForAccessibility="no-hide-descendants"`).
- The hooks in `src/hooks/`: `useBannerSlot(screen, facts, isScreenFocused)` holds the ad moment only
  while its screen is focused and computes `isAllowed` (false while unfocused, so a covered banner
  unmounts). Expo Router's Stack and Tabs keep the task list mounted under every screen pushed over it
  (React Navigation does the same): counting mounted screens would let the primer, Google's form and
  Apple's prompt open over a pushed task editor when the network returns. The model hook passes
  `useIsFocused()` (exported by `expo-router`; React Navigation: `@react-navigation/native`); `useAdContext(facts)` reads `canRequestAds` from the flow and
  `isOnline` from the ConnectivityPort.

Mount `AdsProvider` once, inside the services, data, i18n and theme providers, around the root stack
(`examples/ads-root.tsx`): with Expo Router the root layout's tree is
RootLayout -> DirectionGate -> AppRoot (providers) -> RootStack (GestureHandlerRootView -> MotionConfig
-> navigation theme -> AdsRoot -> AppStack). check-ads `consent-moment` fails when no app file renders
`<AdsProvider>`, when anything but the flow calls `prepareAds`, when `useBannerSlot` does not ask for
the ad moment or holds it regardless of focus, and when a caller passes a literal `true` as the focus.

## When the app calls what

| Moment | Call | Result used for |
|---|---|---|
| App start, after the first render (never awaited) | `refreshAtLaunch` (AdsProvider) | `canRequestAds`, the privacy entry |
| An ad screen is focused and `prepareAds` has not run this session | `prepareAds` (the flow) | the primer and Google's form where required, Apple's prompt while not-determined, then initialize and preload |
| Online again, onboarding ends, or Premium ends while an ad screen is focused | `prepareAds` (the flow retries) | the deferred consent |
| Premium becomes true | nothing | ads stop at once through the policy; the SDK stays initialised and idle |
| The "Ad privacy choices" entry | `consent.showPrivacyOptions()` then `onConsent` | may turn ads off |

Never call the form or the ATT prompt at app start, over a focused task, or from an effect that runs
before onboarding is done. The app has no ATT row in its settings: iOS keeps the answer in Settings >
Privacy & Security > Tracking.

## The "Ad privacy choices" entry point

- Visible only while `isPrivacyOptionsRequired` (from the latest `onConsent`) is true; hidden otherwise,
  never greyed out. Google requires a visible entry point wherever privacy options are required.
- Its handler calls `consent.showPrivacyOptions()` and saves the result (`onConsent`), which may turn
  ads off (`canRequestAds: false`): banners and rewarded offers then disappear through the policy.
- `examples/use-settings-model.ts` (the settings model hook returns `adPrivacy: { isVisible, onPress }`)
  and `examples/ad-privacy-row.tsx` (a pure view of it) are the shape; its look belongs to the settings
  screen (settings-and-preferences). This skill owns when it shows and what it calls.

## Test-only consent tools (the debug geography)

Only in test builds, reachable only through the test-only entry (debug-menu-and-test-hooks owns the
gate `src/test-only.ts` and its entry), never on a store build's path:

- **Debug geography.** `createAdmobConsentAdapter({ debugGeography: 'eea' | 'other', testDeviceIdentifiers,
  tracking, onError })` passes them to `AdsConsent.requestInfoUpdate` (17.2.0: `AdsConsentDebugGeography.EEA` = 1,
  `OTHER` = 4, straight to UMP's debug settings; a simulator or emulator is a test device already, a
  phone needs its hashed id in `testDeviceIdentifiers`). The test-only entry builds that port (a debug
  link's `geo=eea|other`, the debug menu) and resets Google's answer first, so the next `prepareAds`
  asks UMP as for a user in the EEA (the form, on any network) or elsewhere. check-ads
  `debug-geography-test-only` fails `debugGeography`, `testDeviceIdentifiers` or
  `AdsConsentDebugGeography` anywhere else.
- **`admob-consent-debug-adapter.ts`**: `resetConsent()` (`AdsConsent.reset()`), `readUserChoices()`
  (`AdsConsent.getUserChoices()`, the decoded TCF choices) and `openAdInspector()`
  (`mobileAds().openAdInspector()`). Only the test-only entry imports it; `import type
  { ConsentDebugTools }` is fine anywhere (erased). Apple's ATT answer has no reset from code: delete the
  app, or change it in Settings > Privacy & Security > Tracking.

These change consent behaviour for real users, so none may ship in a store build (check-ads
`test-only-api`, `debug-adapter-import`, `debug-geography-test-only`).

## Verified behaviour

Verified on an iOS 26.5 simulator with Google's sample app ID (2026-09-26 and 2026-10-01, the source app;
not re-run for this public skill): after `AdsConsent.reset()`, `requestInfoUpdate({ debugGeography: EEA })`
returned `{ status: 'REQUIRED', privacyOptionsRequirementStatus: 'REQUIRED', canRequestAds: false,
isConsentFormAvailable: true }` and `loadAndShowConsentFormIfRequired()` showed the "Publisher Test Ads"
TCF form (Consent / Do not consent / Manage options); the order primer -> Google's form -> Apple's prompt
-> a test banner held, and a declined prompt still loaded the banner. With `geo=other` the GDPR form never
opened, and Google's sample AdMob app showed its own IDFA explainer before Apple's prompt (test builds
only: the developer's app publishes none). Maestro's `launchApp` grants every permission by default, the
ATT answer included (the status reads authorized and no prompt appears): launch with
`xcrun simctl launch <udid> <bundle id>` or `launchApp: { permissions: { all: unset } }`. Android: the
same UMP flow is expected (UMP 4.0.0 behind the same API); not verified on an emulator for this skill.

The real form appears only after the developer publishes a GDPR message in the AdMob console; without it
`canRequestAds` stays false in the EEA.

## Tests

- `ad-gate.test.ts`: refresh -> primer -> form -> ATT -> initialize -> preload in that order; no primer
  and no form where consent is not required (ATT still first); declined, restricted and unavailable
  tracking still initialize, and Apple is asked once; a failed initialize preloads nothing; no ATT and no
  initialize without consent; nothing during onboarding, for Premium, offline or with ads off.
- `consent-moment-flow.test.ts`, `ads-provider.test.tsx`: the consent moment above.
- `admob-consent-adapter.test.ts` and `.android.test.ts`: the privacy flag, the offline fallback, the debug
  settings only when set; `requestTracking` asks through the `tracking` option and answers
  `'unavailable'` with `tracking: null`.
- `expo-tracking-consent-adapter.test.ts` and `.android.test.ts`: asks once while not-determined, waits
  for an active app, resolves `'unavailable'` on a failed read, and never touches the module on Android.
- `consent-factory.test.ts`: `off` never calls the adapter function; `test` and `live` use it.
- `admob-consent-debug-adapter.test.ts`: the tools reset consent only when asked, read the choices and
  open the Ad Inspector.
- `use-banner-slot.test.tsx`: a blurred list releases the moment: no form and no ATT over a pushed
  screen, the moment runs when the list is focused again.
- check-ad-behaviour runs the same order against the app's real gate, flow, adapter and factory with the
  scripted stand-ins (`consent-order`, `consent-moment-flow`, `consent-adapter`, `tracking-adapter`,
  `consent-factory`, the pushed-screen scenario of `consent-moment-flow`); check-ads `att-adapter-only`,
`att-order`, `att-plugin` and `att-wiring` check the sources.
