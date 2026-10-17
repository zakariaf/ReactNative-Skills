// src/services/ads/ad-moments.test.ts — media is paused around the interstitial, the history changes
// only when it was shown, and a reward is granted only when it was earned.
import { EMPTY_AD_HISTORY } from './ad-history';
import { earnRewardedPerk, showInterstitialIfDue } from './ad-moments';
import { createFakeAds } from './fake-ads';

import type { InterstitialRequest } from './ad-policy';
import type { FakeAdsScript } from './fake-ads';

const REQUEST: InterstitialRequest = {
  config: {
    isAdsEnabled: true,
    minBreaksBeforeFirst: 3,
    minMsBetweenInterstitials: 180_000,
    minBreaksBetween: 2,
    bannerScreens: ['tasks'],
  },
  context: {
    isPremium: false,
    isOnline: true,
    canRequestAds: true,
    isOnboardingDone: true,
    breaksCompletedTotal: 5,
  },
  history: EMPTY_AD_HISTORY,
  trigger: { outcome: 'failure', nowMs: 42 },
};

function setup(script: Omit<FakeAdsScript, 'log'> = {}) {
  const log: string[] = [];
  const ads = createFakeAds({ ...script, log });
  const lifecycle = {
    suspend: () => log.push('suspend'),
    resume: () => log.push('resume'),
  };
  return { log, deps: { ads, lifecycle } };
}

describe('showInterstitialIfDue', () => {
  it('pauses media around the interstitial and records it', async () => {
    const { log, deps } = setup();
    const history = await showInterstitialIfDue(deps, REQUEST);
    expect(log).toStrictEqual(['suspend', 'showInterstitial', 'resume', 'preloadInterstitial']);
    expect(history).toStrictEqual({
      lastInterstitialAtMs: 42,
      breaksSinceInterstitial: 0,
      didLastInterstitialFollowFailure: true,
    });
  });

  it('keeps the history when the ad was unavailable', async () => {
    const { deps } = setup({ interstitialResult: 'unavailable' });
    await expect(showInterstitialIfDue(deps, REQUEST)).resolves.toBe(EMPTY_AD_HISTORY);
  });

  it('keeps the history and shows nothing when the policy says no', async () => {
    const { log, deps } = setup();
    const premium = { ...REQUEST, context: { ...REQUEST.context, isPremium: true } };
    await expect(showInterstitialIfDue(deps, premium)).resolves.toBe(EMPTY_AD_HISTORY);
    expect(log).toStrictEqual([]);
  });
});

describe('earnRewardedPerk', () => {
  it('grants the reward only when it was earned', async () => {
    await expect(earnRewardedPerk(setup().deps)).resolves.toBe(true);
    await expect(earnRewardedPerk(setup({ rewardResult: 'dismissed' }).deps)).resolves.toBe(false);
    await expect(earnRewardedPerk(setup({ rewardResult: 'unavailable' }).deps)).resolves.toBe(
      false,
    );
  });
});
