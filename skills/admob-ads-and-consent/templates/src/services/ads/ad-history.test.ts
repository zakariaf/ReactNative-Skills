// src/services/ads/ad-history.test.ts — successful breaks count, failed ones do not, and a shown
// interstitial restarts the counters.
import { EMPTY_AD_HISTORY, recordBreak, recordInterstitialShown } from './ad-history';

describe('recordBreak', () => {
  it('counts successful breaks only', () => {
    const afterSuccess = recordBreak(EMPTY_AD_HISTORY, 'success');
    expect(afterSuccess.breaksSinceInterstitial).toBe(1);
    expect(recordBreak(afterSuccess, 'failure')).toBe(afterSuccess);
  });
});

describe('recordInterstitialShown', () => {
  it('restarts the counters and remembers a failed break', () => {
    const counted = recordBreak(recordBreak(EMPTY_AD_HISTORY, 'success'), 'success');
    expect(counted.breaksSinceInterstitial).toBe(2);
    expect(recordInterstitialShown({ nowMs: 5_000, outcome: 'failure' })).toStrictEqual({
      lastInterstitialAtMs: 5_000,
      breaksSinceInterstitial: 0,
      didLastInterstitialFollowFailure: true,
    });
  });
});
