// src/services/ads/ad-policy.ts
// Every "may an ad appear now?" answer, as pure functions: no SDK, no clock, no storage; every fact
// is an argument. Ads never interrupt a focused task: banners only on declared screens,
// interstitials only at a natural break the user just finished (and paced), rewarded ads only on the
// user's explicit choice (rewarded-offer.ts).

/** How the break that may lead to an interstitial ended (a finished session, an abandoned one). */
export type BreakOutcome = 'success' | 'failure';

/** The app's pacing numbers (src/config/ad-pacing.ts): configuration, never hard-coded here. */
export type AdPolicyConfig = {
  /** The master switch: false in an ADS_MODE=off build and when the app turns ads off. */
  readonly isAdsEnabled: boolean;
  /** Natural breaks the user must finish before the first interstitial ever (default 3). */
  readonly minBreaksBeforeFirst: number;
  /** Milliseconds since the last interstitial (default 180_000). */
  readonly minMsBetweenInterstitials: number;
  /** Natural breaks finished since the last interstitial (default 2). */
  readonly minBreaksBetween: number;
  /** The screens that may show a banner (each slot's testID is '<screen>.banner-ad'). */
  readonly bannerScreens: readonly string[];
};

/** Live facts, read at decision time. */
export type AdContext = {
  /** The Premium entitlement removes every ad at once. */
  readonly isPremium: boolean;
  readonly isOnline: boolean;
  /** Google's UMP says ads may be requested (and prepareAds finished this session). */
  readonly canRequestAds: boolean;
  /** No ad before the user finished onboarding: the first minutes are the app, not ads. */
  readonly isOnboardingDone: boolean;
  /** Natural breaks finished, all time. */
  readonly breaksCompletedTotal: number;
};

/** Saved with the app's data (ad-history.ts updates it), so a restart never resets the pacing. */
export type AdHistory = {
  readonly lastInterstitialAtMs: number | null;
  readonly breaksSinceInterstitial: number;
  readonly didLastInterstitialFollowFailure: boolean;
};

/** One interstitial decision, made in the press handler that leaves a natural break. */
export type InterstitialRequest = {
  readonly config: AdPolicyConfig;
  readonly context: AdContext;
  readonly history: AdHistory;
  readonly trigger: { readonly outcome: BreakOutcome; readonly nowMs: number };
};

/** The gate every ad format shares. */
export function canServeAds(config: AdPolicyConfig, context: AdContext): boolean {
  return config.isAdsEnabled && !context.isPremium && context.isOnline && context.canRequestAds;
}

/** Whether `screen` may show its banner now. */
export function shouldShowBanner(
  config: AdPolicyConfig,
  context: AdContext,
  screen: string,
): boolean {
  return (
    canServeAds(config, context) &&
    context.isOnboardingDone &&
    config.bannerScreens.includes(screen)
  );
}

// A clock that went backwards makes the stored time meaningless: ignore it.
function msSinceLast(history: AdHistory, nowMs: number): number | null {
  const last = history.lastInterstitialAtMs;
  return last === null || last > nowMs ? null : nowMs - last;
}

/** Whether the break the user just left may end with an interstitial. */
export function shouldShowInterstitial({
  config,
  context,
  history,
  trigger,
}: InterstitialRequest): boolean {
  if (!canServeAds(config, context) || !context.isOnboardingDone) return false;
  if (context.breaksCompletedTotal < config.minBreaksBeforeFirst) return false;
  // Two interstitials in a row may not both follow a failed break: a struggling user gets a rest.
  if (trigger.outcome === 'failure' && history.didLastInterstitialFollowFailure) return false;
  const elapsed = msSinceLast(history, trigger.nowMs);
  if (elapsed === null) return true;
  return (
    elapsed >= config.minMsBetweenInterstitials &&
    history.breaksSinceInterstitial >= config.minBreaksBetween
  );
}
