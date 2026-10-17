// src/services/ads/ad-history.ts
// The saved pacing facts. recordBreak is called in exactly one place, where a natural break finishes
// (check-ads rule break-recorded): without it no second interstitial ever comes due.
import type { AdHistory, BreakOutcome } from './ad-policy';

/** Nothing shown yet. */
export const EMPTY_AD_HISTORY: AdHistory = {
  lastInterstitialAtMs: null,
  breaksSinceInterstitial: 0,
  didLastInterstitialFollowFailure: false,
};

/** Every finished break, saved with it: a success counts toward the pacing, a failure does not. */
export function recordBreak(history: AdHistory, outcome: BreakOutcome): AdHistory {
  return outcome === 'success'
    ? { ...history, breaksSinceInterstitial: history.breaksSinceInterstitial + 1 }
    : history;
}

/** Only when the interstitial was really shown (the adapter answered 'shown'). */
export function recordInterstitialShown(shown: {
  readonly nowMs: number;
  readonly outcome: BreakOutcome;
}): AdHistory {
  return {
    lastInterstitialAtMs: shown.nowMs,
    breaksSinceInterstitial: 0,
    didLastInterstitialFollowFailure: shown.outcome === 'failure',
  };
}
