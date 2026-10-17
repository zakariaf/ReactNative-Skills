# The ad policy (pacing as pure functions)

## Contents

- The defaults this skill enforces
- ad-policy.ts: canServeAds, shouldShowBanner, shouldShowInterstitial
- The pacing config and its floors
- ad-history.ts: what is saved and when
- rewarded-offer.ts: free, watch-ad, loading or hidden
- Interpretations the tests pin
- Tests and mutation boundaries
- What the checkers cannot see

## The defaults this skill enforces

Ads never interrupt a focused task:

- **Banner.** Only on the screens the app declares (contracts/ads.json `bannerSlots`, the same screens in
  `AD_PACING.bannerScreens`): browsing screens such as a task list, never a form, an editor, a dialog, a
  purchase or paywall screen, onboarding or a screen where the user is in the middle of something.
  Shown only when ads are on, the user is not Premium, the device is online and consent is handled; a
  banner that does not load leaves no empty space.
- **Interstitial** (full screen). Only from the press handler that leaves a natural break the user just
  finished (a completed review, a finished session), and only when: not Premium, online, consent
  handled, onboarding done, at least 3 breaks finished in total; at least 3 minutes and 2 finished
  breaks since the last interstitial; never twice in a row after failed breaks. Never on app start,
  never on a screen's mount, never during onboarding.
- **Rewarded.** Always the user's choice, behind a clear "Watch an ad to ..." label. The reward is given
  only when the ad was watched (`EARNED_REWARD`). When no ad can come, the offer is hidden, never broken.

Consent and tracking come before every format (consent-flow.md). The ATT answer never changes this
policy: a declined, restricted or unavailable answer serves the same ads without the IDFA, and nothing
depends on it. Premium removes every ad at once and makes rewarded perks free. Ad slots never overlap
controls (an accidental tap on an ad is invalid traffic). Ads load in the background at quiet moments;
the app never waits for an ad; a failed load is silent. Development and preview builds use only
Google's test ads. Content filters (gambling, dating, alcohol, ...) are set in the AdMob console.

These defaults are this library's: Google's policies forbid ads that interrupt or that the user can
click by accident, and these numbers keep a utility app usable. An app may raise every number; it lowers
one only by lowering its floor in contracts/ads.json, a decision the developer makes.

## ad-policy.ts: canServeAds, shouldShowBanner, shouldShowInterstitial

`src/services/ads/ad-policy.ts` has no SDK, no clock and no storage: everything is an argument
(check-ads `pure-policy`: sibling imports only, no `Date.now`, `new Date`, `Math.random`).

- `AdPolicyConfig` (`src/config/ad-pacing.ts`): `isAdsEnabled`, `minBreaksBeforeFirst` (3),
  `minMsBetweenInterstitials` (180 000), `minBreaksBetween` (2), `bannerScreens`. AdsProvider passes
  `isAdsEnabled` as the app's switch AND `adsMode !== 'off'`.
- `AdContext` (live facts at decision time): `isPremium`, `isOnline` (ConnectivityPort), `canRequestAds`
  (the consent moment), `isOnboardingDone`, `breaksCompletedTotal` (all time).
- `AdHistory` (saved): `lastInterstitialAtMs`, `breaksSinceInterstitial`, `didLastInterstitialFollowFailure`.
- `canServeAds(config, context)` = ads enabled and not Premium and online and consent handled.
- `shouldShowBanner(config, context, screen)` = `canServeAds` and onboarding done and `screen` in
  `config.bannerScreens`.
- `shouldShowInterstitial({ config, context, history, trigger })`, `trigger = { outcome: 'success' |
  'failure', nowMs }`:
  1. false unless `canServeAds` and onboarding done;
  2. false while `breaksCompletedTotal < minBreaksBeforeFirst`;
  3. false when the outcome is `failure` and the last interstitial also followed a failure;
  4. true when none was shown yet (or the stored time lies in the future: the clock moved back);
  5. otherwise true only when both `elapsed >= minMsBetweenInterstitials` and
     `breaksSinceInterstitial >= minBreaksBetween`.

`nowMs` comes from the ClockPort; the policy never reads a clock itself.

## The pacing config and its floors

`src/config/ad-pacing.ts` exports `AD_PACING`. check-ads `policy-numbers` requires the three numbers as
literals and at or above contracts/ads.json `pacingFloors` (default 3 / 180 000 / 2);
`banner-placement` requires every declared slot's screen in `bannerScreens`. check-ad-behaviour feeds the
real `shouldShowInterstitial` a gentler config (5 / 60 000 / 1) to prove no number is hard-coded.

## ad-history.ts: what is saved and when

- `EMPTY_AD_HISTORY`: nothing shown yet.
- `recordBreak(history, outcome)`: every finished natural break, saved together with the break itself
  (one write). A success adds one to `breaksSinceInterstitial`; a failure changes nothing. The call
  sits where the break finishes (the store action or model hook that completes it); check-ads
  `break-recorded` fails when no app code calls it: without it, after the first interstitial no second
  one is ever due.
- `recordInterstitialShown({ nowMs, outcome })`: only when the interstitial was shown; resets the counter
  and remembers whether it followed a failure.
- The history and the consent answer live in the app's own storage (persistence-and-migrations: a table
  or the small key-value store), written after every break and every shown interstitial, so a restart
  does not reset the pacing. This skill defines only the three fields.

## rewarded-offer.ts: free, watch-ad, loading or hidden

`rewardedOffer(perk, { config, context, rewardedStatus })`, where `perk = { isAvailable,
freeAllowanceLeft, waitsWhileLoading }` and `rewardedStatus` is the AdsPort's `'loading' | 'ready' |
'unavailable'`:

| Situation | Result |
|---|---|
| The perk does not apply now (`isAvailable` false: used, not allowed) | `hidden`, even for Premium |
| Premium (online or offline) | `free` |
| A free use left (a daily allowance from the app's config) | `free` |

`freeAllowanceLeft` is computed from a number in `src/config` (the allowance) minus what the user has
used, never typed where the offer is built: a literal drifts from the pacing review and from what the
store listing promises. `0` means "no free use". check-ads `free-allowance-config` flags a positive
literal in feature code; a test pins the computed value (`allowance 2, used 2 -> 0 -> watch-ad`).
| Ads may be served and the rewarded ad is ready | `watch-ad` |
| A perk the user waits on (`waitsWhileLoading`), ads may be served, its ad still loading | `loading` (drawn busy, not pressable) |
| A perk that does not wait, its ad still loading | `hidden` |
| Anything else (offline, no consent, ads off, no ad can come) | `hidden` (never a broken button) |

`free` runs the perk directly. `watch-ad` shows "Watch an ad to ..." and calls `earnRewardedPerk`; the
perk runs only when it returns `true`. A dismissed ad changes nothing and says nothing.

**Never strand a waiting user.** `hidden` always means the reward cannot be had, never "still loading":
a flow that waits on an offer (`waitsWhileLoading`) moves on as soon as it turns hidden, for example the
user's "restore a deleted list" offer closes and the list stays deleted. `useRewardedOffer(perk, facts)`
(`src/hooks/`) keeps the offer live (`useSyncExternalStore` over `subscribeRewardedStatus`).

## Interpretations the tests pin

- "Finished breaks" count successes only.
- "At least 3 minutes and 2 breaks since the last one" applies once an interstitial has been shown;
  before that only the "3 breaks in total" rule gates.
- "Never twice in a row after failures" means two consecutive interstitials may not both follow a failed
  break. With the default numbers it rarely triggers (failures add no breaks), but the numbers are
  configurable.
- A stored last-shown time in the future (the clock moved back) is ignored: only the all-time
  `minBreaksBeforeFirst` still applies, and the time and breaks-since rules are skipped for that one
  decision (the next shown interstitial writes a fresh time).

## Tests and mutation boundaries

`ad-policy.test.ts` covers the first interstitial at 3 breaks (not at 2); Premium, offline, no consent,
onboarding and the switch each block; 3 minutes AND 2 breaks (179 999 ms fails, 180 000 passes; one break
fails); a second interstitial after failures blocked, a success not; every number read from the config;
exactly 3 breaks passes; the same millisecond fails; a future time is ignored; a fast-check property that
Premium never sees an interstitial or a banner; banners only on the declared screens.

The two boundary cases ("exactly 3" and "the same millisecond") exist because a mutation run (Stryker)
left two survivors without them. Keep them; run `npx stryker run --mutate src/services/ads/ad-policy.ts`
after changing the policy (unit-and-component-tests).

`rewarded-offer.test.ts` is one table (above). `ad-history.test.ts`: successes count, failures do not, a
shown interstitial resets. check-ad-behaviour runs the same tables against the app's real modules
(`interstitial-rules`, `banner-rules`, `rewarded-offer-rules`, `ad-history`), so a weakened Jest test
cannot hide a broken rule.

## What the checkers cannot see

check-ads reads sources with patterns, not a type checker, so a few rules are heuristics with known
limits. They are documented here instead of grown into fragile regexes; the behaviour checker, the Jest
suites and review cover the rest.

- `port-calls` finds `showInterstitial(`, `showRewarded(`, `preloadInterstitial(` and `preloadRewarded(`
  by name anywhere in app code, but `initialize(` only on a receiver named `ads...` or `...Ads`
  (`deps.ads`, `adsPort`, `createAdsPort(...)`): an AdsPort kept under another name
  (`const port = services.ads; port.initialize()`) is not seen.
- `consent-moment` checks that `useBannerSlot`'s effect and `isAllowed` mention the focus, and flags a
  literal `true` as the focus argument; a caller that passes a constant through a variable is not seen.
- `att-wiring` reads the arguments of `createAdmobConsentAdapter(...)`: a `tracking` value built in
  another file is judged by whether that file calls `createExpoTrackingConsentAdapter(`.
- `free-allowance-config` flags only a positive number literal written as `freeAllowanceLeft: <n>`.
- `ads-extra-binary` flags `readAdsExtra(` calls; a copy of its parsing logic elsewhere is not seen.
- `ad-in-effect` sees an ad call (`showInterstitialIfDue`, `earnRewardedPerk`, `showInterstitial`,
  `showRewarded`) inside `useEffect`/`useLayoutEffect`/`useFocusEffect`/`useInsertionEffect` or an
  `AppState.addEventListener(...)` callback (an app-resume ad), directly or through one same-file helper
  (`useEffect(() => { finishReview().catch(reportError); }, [])` where `finishReview` calls
  `showInterstitialIfDue`). It does not follow a helper two steps removed, a helper imported from
  another file, or a resume signal read some other way (a `useIsAppActive()` value an effect watches is
  caught as an effect; a custom event emitter is not).
- `break-recorded` requires one `recordBreak(` call in app code outside `src/services/ads/` and flags a
  call whose result is thrown away (a bare `recordBreak(history, 'success');` statement). It cannot see
  a result that is assigned and then never saved (`const counted = recordBreak(...)` with no
  `saveBreak(counted)`); the behaviour checker's pacing scenarios and the model hook's test cover that.
