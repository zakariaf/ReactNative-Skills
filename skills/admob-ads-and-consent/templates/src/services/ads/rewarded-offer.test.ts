// src/services/ads/rewarded-offer.test.ts — one row per situation: 'hidden' always means the reward
// cannot be had, never "still loading".
import { rewardedOffer } from './rewarded-offer';

import type { AdContext, AdPolicyConfig } from './ad-policy';
import type { RewardedStatus } from './ads-port';
import type { RewardedOffer, RewardedPerk } from './rewarded-offer';

const CONFIG: AdPolicyConfig = {
  isAdsEnabled: true,
  minBreaksBeforeFirst: 3,
  minMsBetweenInterstitials: 180_000,
  minBreaksBetween: 2,
  bannerScreens: ['tasks'],
};
const READY: AdContext = {
  isPremium: false,
  isOnline: true,
  canRequestAds: true,
  isOnboardingDone: true,
  breaksCompletedTotal: 10,
};
const WAITING: RewardedPerk = { isAvailable: true, freeAllowanceLeft: 0, waitsWhileLoading: true };
const PASSING: RewardedPerk = { isAvailable: true, freeAllowanceLeft: 0, waitsWhileLoading: false };

function offerOf(perk: RewardedPerk, context: AdContext, status: RewardedStatus): RewardedOffer {
  return rewardedOffer(perk, { config: CONFIG, context, rewardedStatus: status });
}

describe('rewardedOffer', () => {
  type Row = {
    readonly name: string;
    readonly context: AdContext;
    readonly status: RewardedStatus;
    readonly expected: RewardedOffer;
  };
  const offline = { ...READY, isOnline: false };
  const noConsent = { ...READY, canRequestAds: false };
  it.each<Row>([
    {
      name: 'Premium',
      context: { ...READY, isPremium: true },
      status: 'unavailable',
      expected: 'free',
    },
    { name: 'a ready ad', context: READY, status: 'ready', expected: 'watch-ad' },
    { name: 'a loading ad', context: READY, status: 'loading', expected: 'loading' },
    { name: 'an ad that cannot come', context: READY, status: 'unavailable', expected: 'hidden' },
    { name: 'offline with an ad ready', context: offline, status: 'ready', expected: 'hidden' },
    { name: 'offline while loading', context: offline, status: 'loading', expected: 'hidden' },
    {
      name: 'no consent with an ad ready',
      context: noConsent,
      status: 'ready',
      expected: 'hidden',
    },
    { name: 'no consent while loading', context: noConsent, status: 'loading', expected: 'hidden' },
  ])('offers a waiting perk as $expected for $name', ({ context, status, expected }) => {
    expect(offerOf(WAITING, context, status)).toBe(expected);
  });

  it('hides a perk that does not wait while its ad loads', () => {
    expect(offerOf(PASSING, READY, 'loading')).toBe('hidden');
    expect(offerOf(PASSING, READY, 'ready')).toBe('watch-ad');
    expect(offerOf(PASSING, READY, 'unavailable')).toBe('hidden');
  });

  it('makes the reward free for Premium (offline too) and while a free use is left', () => {
    const premium = { ...READY, isPremium: true, isOnline: false };
    expect(offerOf(WAITING, premium, 'unavailable')).toBe('free');
    expect(offerOf({ ...PASSING, freeAllowanceLeft: 1 }, READY, 'loading')).toBe('free');
  });

  it('hides an unavailable perk, even for Premium', () => {
    const used = { ...WAITING, isAvailable: false };
    expect(offerOf(used, { ...READY, isPremium: true }, 'ready')).toBe('hidden');
    expect(offerOf(used, READY, 'loading')).toBe('hidden');
  });
});
