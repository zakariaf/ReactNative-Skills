# Placements, the fullscreen lifecycle and offline behaviour

## Contents

- AdsPort and the AdMob adapter
- Banner: AdBannerSlot on the declared screens
- Interstitial: at a natural break
- Rewarded offers
- Pausing media around fullscreen ads (iOS and Android)
- Preloading at quiet moments
- ConnectivityPort and offline behaviour
- When the app uses React Navigation

## AdsPort and the AdMob adapter

```ts
export type AdsPort = {
  readonly initialize: () => Promise<Result<true, AdsInitFailure>>; // after consent and ATT; idempotent
  readonly preloadInterstitial: () => void;
  readonly preloadRewarded: () => void;
  readonly rewardedStatus: () => RewardedStatus; // 'loading' | 'ready' | 'unavailable'
  readonly subscribeRewardedStatus: (listener: () => void) => () => void; // useSyncExternalStore
  readonly showInterstitial: () => Promise<FullscreenResult>; // 'shown' | 'unavailable'; never rejects
  readonly showRewarded: () => Promise<RewardResult>; // 'rewarded' | 'dismissed' | 'unavailable'
  readonly renderBanner: (props: BannerSlotProps) => ReactNode;
};
```

Facts behind `admob-ads-adapter.ts` (read in the 17.2.0 source and the library's shipped `AGENTS.md`):

- It keeps the classic create/load/show API on purpose. The v17 fullscreen hooks (`useInterstitialAd`,
  `useRewardedAd`, ...) tie ads to a component's lifetime, and preload pools (`AdPools`, `AdPoolProvider`,
  `usePooledAd`) start preloading as soon as they exist (on Android they also initialise the SDK) —
  before consent. Display pools and multi-format requests need Ad Manager units. The library recommends
  hooks, so the adapter says in a comment that the choice is deliberate (check-ads `sdk-api`).
- `show()` rejects when the ad is not loaded, already showing or declined, and throws synchronously on a
  destroyed ad. The adapter checks `loaded` first, records a rejection and answers `'unavailable'`, so
  callers never handle exceptions.
- There is no `SHOW_FAILED` event: a failed presentation arrives as `AdEventType.ERROR` with
  `phase: 'show'`, and no `CLOSED` follows. The native `show()` resolves as soon as it asks the OS to
  present, so a presentation that fails later reaches JS only as that `ERROR`. The show promise
  therefore settles on `CLOSED`, on `ERROR` and on a rejected `show()`; without the `ERROR` branch it
  never settles, media stays suspended and the press handler never navigates (check-ad-behaviour
  `adapter-interstitial`).
- A fullscreen ad object is used once; after `CLOSED` it is destroyed and the caller preloads the next.
- **The rewarded status.** `'loading'` from the start of a preload until `LOADED` or a load error,
  `'ready'` after `LOADED`, `'unavailable'` after a load error until the next preload, once the loaded ad
  was shown, with ads off and before `initialize` (a preload before `initialize` starts nothing). Every
  change tells the subscribers. Never a loaded flag (check-ads `rewarded-status`): "not loaded" would
  mean both "still loading" and "cannot come".
- The reward is granted only on `RewardedAdEventType.EARNED_REWARD`; `CLOSED` alone resolves
  `'dismissed'`. The reward amount and type set in the AdMob console are ignored: one ad, one reward.
- Errors: branch on `error.phase` first, then `error.reason`; never the legacy `error.code` (deprecated
  in 17.2.0, removed in v18; check-ads `error-code-branch`). Load-phase `no-fill` / `mediation-no-fill` is
  routine and not logged; everything else goes to `onAdError` (the error log), never to the user.
- `initialize()` returns a Result: an SDK rejection is recorded raw and becomes
  `{ ok: false, error: { kind: 'ads-init-failed' } }`; a failed run is forgotten so the next call
  retries (error-handling-typed-results: adapters convert at the boundary).
- The banner uses `BannerAdSize.LARGE_ANCHORED_ADAPTIVE_BANNER`; `ANCHORED_ADAPTIVE_BANNER` is
  deprecated in 17.2.0 (check-ads `deprecated-banner-size`). It is created with `createElement`, so the
  adapter stays one `.ts` file the behaviour check can load.
- `fake-ads.ts` (`createFakeAds(script)`) is the Jest fake; runtime code never imports it (an `off` build
  gets the disabled port from `createAdsPort`).

## Banner: AdBannerSlot on the declared screens

```tsx
// use-tasks-model.ts (the screen's model hook)
const isFocused = useIsFocused(); // from 'expo-router'
banner: useBannerSlot('tasks', facts, isFocused),
// tasks-screen.tsx (the pure view), below the list and above the bottom safe-area inset
<AdBannerSlot testID="tasks.banner-ad" renderBanner={banner.renderBanner} isAllowed={banner.isAllowed} />
```

- Only on the screens contracts/ads.json `bannerSlots` names (folder -> testID `<screen>.banner-ad`), each
  also in `AD_PACING.bannerScreens` (check-ads `banner-placement`).
- `isAllowed` always comes from the policy: `useBannerSlot(screen, facts, isFocused)` (which calls
  `shouldShowBanner`), or `shouldShowBanner(config, context, screen)` in the model hook; never a
  hand-made boolean. `useBannerSlot` also holds the consent moment's ad moment while the screen is
  focused (check-ads `consent-moment`).
- **Focus, not mount.** Expo Router's Stack keeps the task list mounted under every screen pushed over
  it, and Tabs keep every visited tab mounted (React Navigation: the same). A slot that counted mounting
  would hold the ad moment, and keep its banner mounted and refreshing, while the user edits a task: the
  primer, Google's form and Apple's prompt could open over the editor when the network returns. So the
  model hook passes `useIsFocused()` (exported by `expo-router` 57; React Navigation:
  `@react-navigation/native`): on blur the moment is released and `isAllowed` turns false, so the
  hidden banner unmounts; on focus it mounts again and loads a fresh ad. A literal `true` is a failure
  (check-ads `consent-moment`).
- `src/ui/ad-banner-slot.tsx` is presentational and never imports services (the UI boundary), so the
  model hands `renderBanner` in.
- The adapter's `renderBanner` returns a small component (`ReadyBanner`) that reads the initialised flag
  with `useSyncExternalStore` and draws `BannerAd` only once `initialize` has finished: the native view
  requests its ad as it mounts, and a slot may be allowed earlier (the saved answer of the last session),
  so without it a banner could ask for an ad before consent and the ATT answer (check-ad-behaviour
  `adapter-banner`).
- The slot has zero height until `onLoaded` fires and collapses again on `onFailed`: a failed or offline
  load leaves no empty box and no message. A frame (a band, a divider) goes in `loadedStyle`, applied only
  after a load. Never wrap the slot in a component that renders nothing until an ad has loaded: the
  native banner has to be mounted to load at all.
- `isAllowed` is recomputed from the live facts on every render, so buying Premium, going offline or
  withdrawing consent removes the banner at once.
- Edge-to-edge (Android 15+, and every SDK 57 app): keep the slot above the navigation-bar inset
  (`useSafeAreaInsets().bottom` as padding below it), as on iOS above the home indicator.
- Screenshots and visual baselines run with `ADS_MODE=off`, so no slot draws at all; a design that
  reserves space for the banner shows it through a test-only placeholder renderer passed as
  `renderBanner`, never through a placeholder in `AdBannerSlot`, the adapter or the fake.
- Open item: whether a banner inside a zero-height container still receives `onAdLoaded` on every OS
  version was not verified on a device. Confirm it in the first `ADS_MODE=test` smoke run on iOS and
  Android; if it does not load, render it off-screen (`position: 'absolute'`, `opacity: 0`) until loaded,
  and update the template and its test.

## Interstitial: at a natural break

`ad-moments.ts` holds the only two moments a fullscreen ad may appear.

1. The user finishes a natural break (completes a review, ends a session). The code that completes it
   saves `recordBreak(history, outcome)` with the break itself.
2. In the press handler that leaves it ("Done"), call `showInterstitialIfDue({ ads, lifecycle },
   { config, context, history, trigger: { outcome, nowMs: clock.nowMs() } })`, save the returned
   history, then navigate. Never from an effect (check-ads `ad-in-effect`): an effect shows the ad over
   the screen the user just reached.
3. `showInterstitialIfDue` returns the history unchanged when the policy says no; otherwise it runs the
   ad inside `runFullscreenAd`, preloads the next one, and returns `recordInterstitialShown(trigger)`
   only when the result was `'shown'`.

Event handlers stay synchronous (typescript-and-lint-rules): start the async work and end it with
`.catch(reportError)` (`examples/use-tasks-model.ts`).

## Rewarded offers

- Render the offer from `useRewardedOffer(perk, facts)` (`rewardedOffer` over the live rewarded status).
- `'watch-ad'`: the "Watch an ad to ..." label; the press handler calls `earnRewardedPerk({ ads, lifecycle })`
  and grants the reward only when it returns `true`.
- `'loading'` (a perk the user waits on): the same offer drawn busy, `accessibilityState={{ busy: true }}`,
  not pressable; no new copy.
- `'hidden'`: no offer at all, and a flow that waited on it moves on.
- A reward granted during a task pauses that task's media first (the lifecycle does it) and returns to
  the same state.

## Pausing media around fullscreen ads (iOS and Android)

On iOS a Google fullscreen ad does not background the app (`AppState` stays `active`), so audio, video,
timers and animations keep running unless the app pauses them. On Android the ad is its own activity,
so `AppState` may move to `background` and back (expected from the activity lifecycle; not verified on a
device for this skill): code that reacts to backgrounding (a lock screen, a sync) may run during an ad.
Pause explicitly on both platforms:

```ts
export async function runFullscreenAd<T>(lifecycle: MediaLifecycle, show: () => Promise<T>): Promise<T> {
  lifecycle.suspend('fullscreen-ad');
  try {
    return await show();
  } finally {
    lifecycle.resume('fullscreen-ad');
  }
}
```

`createFullscreenAdGate()` is a ready-made `MediaLifecycle` with `isShowing()` and `subscribe()`: create it
once in the composition root (`fullscreenAd`), pass it to every fullscreen ad, and let audio
(audio-and-haptics-feedback), video and animation code read it with `useSyncExternalStore`. A second,
private lifecycle object would leave the music playing under the ad. `fullscreen-ad.test.ts` proves the
order (suspend, show, resume) and that media resumes when the ad fails (check-ad-behaviour
`fullscreen-lifecycle`).

**Only the moment modules call the port.** `AdsPort.showInterstitial()` / `showRewarded()` are called
only by `ad-moments.ts` (`showInterstitialIfDue`, `earnRewardedPerk`), and `initialize()` /
`preloadInterstitial()` / `preloadRewarded()` only by `ad-gate.ts` and `ad-moments.ts`. A direct
`deps.ads.showInterstitial()` in a press handler skips the pacing policy, the media pause and the
history; `createAdsPort(...).initialize()` in the composition root initialises before consent and ATT.
check-ads `port-calls` fails both (the adapter, the fake, the factory, tests and test-only code
excepted).

## Preloading at quiet moments

Preloading happens only at quiet moments: in `prepareAds` (the first time an ad screen is focused), right
after each fullscreen ad, and when the user starts a task that may end with an offer if nothing is
loaded. The app never waits for an ad.

## ConnectivityPort and offline behaviour

The canonical `src/services/connectivity/` (networking-and-server-state) is the one answer to "is the
device on a network": `isOnline()`/`subscribe()` mean "on any network", and `reachability()` adds
Android's validation hint (`'unvalidated'`). Ads read `isOnline()` (through `useAdContext` and
AdsProvider); never `expo-network` or NetInfo directly. A test build's "simulate offline" switch wraps
the real adapter once (debug-menu-and-test-hooks), so every reader follows it.

| Situation | Banner | Interstitial | Rewarded offer | Consent |
|---|---|---|---|---|
| Online, consent handled, not Premium | shown when loaded | per the policy | shown when ready | refreshed at launch |
| Offline | slot collapsed, no message | never | hidden | the refresh fails -> cached `canRequestAds`; the form waits |
| Premium | never | never | free | not requested |
| `canRequestAds` false | never | never | hidden | the privacy entry lets the user change it |
| `ADS_MODE=off` / the switch off | never | never | hidden (a free allowance only) | never requested |

Never show an error, a spinner or a "please connect" message for ads.

## When the app uses React Navigation

With React Navigation 7 (static API) instead of Expo Router, mount `AdsProvider` inside
`NavigationContainer`'s providers around the root navigator, in the same place relative to the services,
i18n and theme providers; `useFocusEffect` is the screen-focus signal, and a banner screen's model hook
calls `useBannerSlot` the same way, with `useIsFocused()` from `@react-navigation/native` (its stack
and tab navigators keep screens mounted too). An ad never runs from `useFocusEffect` (check-ads
`ad-in-effect` covers it).
