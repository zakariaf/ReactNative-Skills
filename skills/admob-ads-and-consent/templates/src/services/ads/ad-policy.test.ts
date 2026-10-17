// src/services/ads/ad-policy.test.ts — the pacing rules, their boundaries, and a property: Premium
// never sees an ad.
import fc from 'fast-check';

import { EMPTY_AD_HISTORY, recordBreak, recordInterstitialShown } from './ad-history';
import { shouldShowBanner, shouldShowInterstitial } from './ad-policy';

import type {
  AdContext,
  AdHistory,
  AdPolicyConfig,
  BreakOutcome,
  InterstitialRequest,
} from './ad-policy';

const CONFIG: AdPolicyConfig = {
  isAdsEnabled: true,
  minBreaksBeforeFirst: 3,
  minMsBetweenInterstitials: 180_000,
  minBreaksBetween: 2,
  bannerScreens: ['tasks', 'lists'],
};
const READY: AdContext = {
  isPremium: false,
  isOnline: true,
  canRequestAds: true,
  isOnboardingDone: true,
  breaksCompletedTotal: 10,
};
const T0 = 1_000_000_000;
const SHOWN_AT_T0 = recordInterstitialShown({ nowMs: T0, outcome: 'success' });
const AFTER_TWO: AdHistory = recordBreak(recordBreak(SHOWN_AT_T0, 'success'), 'success');

function request(overrides: Partial<InterstitialRequest> = {}): InterstitialRequest {
  return {
    config: CONFIG,
    context: READY,
    history: EMPTY_AD_HISTORY,
    trigger: { outcome: 'success', nowMs: T0 },
    ...overrides,
  };
}

function at(history: AdHistory, outcome: BreakOutcome, nowMs: number): InterstitialRequest {
  return request({ history, trigger: { outcome, nowMs } });
}

describe('shouldShowInterstitial', () => {
  it('allows the first interstitial once 3 breaks are finished', () => {
    expect(shouldShowInterstitial(request())).toBe(true);
    const early = { ...READY, breaksCompletedTotal: 2 };
    expect(shouldShowInterstitial(request({ context: early }))).toBe(false);
  });

  it.each([
    ['premium', { isPremium: true }],
    ['offline', { isOnline: false }],
    ['consent not handled', { canRequestAds: false }],
    ['onboarding running', { isOnboardingDone: false }],
  ] as const)('blocks when %s', (_label, change) => {
    expect(shouldShowInterstitial(request({ context: { ...READY, ...change } }))).toBe(false);
  });

  it('blocks with the master switch off', () => {
    const config = { ...CONFIG, isAdsEnabled: false };
    expect(shouldShowInterstitial(request({ config }))).toBe(false);
  });

  it('requires 3 minutes AND 2 finished breaks since the last one', () => {
    expect(shouldShowInterstitial(at(AFTER_TWO, 'success', T0 + 179_999))).toBe(false);
    expect(shouldShowInterstitial(at(AFTER_TWO, 'success', T0 + 180_000))).toBe(true);
    const one = recordBreak(SHOWN_AT_T0, 'success');
    expect(shouldShowInterstitial(at(one, 'success', T0 + 999_999))).toBe(false);
  });

  it('blocks a second interstitial in a row after failed breaks', () => {
    const afterFailure = { ...AFTER_TWO, didLastInterstitialFollowFailure: true };
    expect(shouldShowInterstitial(at(afterFailure, 'failure', T0 + 999_999))).toBe(false);
    expect(shouldShowInterstitial(at(afterFailure, 'success', T0 + 999_999))).toBe(true);
  });

  it('reads every number from the config', () => {
    const gentle = {
      ...CONFIG,
      minBreaksBeforeFirst: 5,
      minMsBetweenInterstitials: 60_000,
      minBreaksBetween: 1,
    };
    const four = { ...READY, breaksCompletedTotal: 4 };
    expect(shouldShowInterstitial(request({ config: gentle, context: four }))).toBe(false);
    const one = recordBreak(SHOWN_AT_T0, 'success');
    expect(shouldShowInterstitial({ ...at(one, 'success', T0 + 60_000), config: gentle })).toBe(
      true,
    );
  });

  // Mutation boundaries (a Stryker run left both alive without them): keep these two.
  it('allows the first interstitial at exactly 3 finished breaks', () => {
    const exactly = { ...READY, breaksCompletedTotal: 3 };
    expect(shouldShowInterstitial(request({ context: exactly }))).toBe(true);
  });

  it('blocks an interstitial in the same millisecond as the last one', () => {
    expect(shouldShowInterstitial(at(AFTER_TWO, 'success', T0))).toBe(false);
  });

  it('ignores a last-shown time in the future (the clock moved backwards)', () => {
    expect(shouldShowInterstitial(at(AFTER_TWO, 'success', T0 - 5))).toBe(true);
  });

  it('hides every ad from a Premium user (property)', () => {
    const facts = fc.record({
      isOnline: fc.boolean(),
      isOnboardingDone: fc.boolean(),
      breaksCompletedTotal: fc.nat(),
    });
    fc.assert(
      fc.property(facts, fc.nat(), (fact, nowMs) => {
        const context = { ...READY, ...fact, isPremium: true };
        expect(
          shouldShowInterstitial(request({ context, trigger: { outcome: 'success', nowMs } })),
        ).toBe(false);
        expect(shouldShowBanner(CONFIG, context, 'tasks')).toBe(false);
      }),
      { seed: 42, numRuns: 200 },
    );
  });
});

describe('shouldShowBanner', () => {
  it('shows banners only on the declared screens', () => {
    expect(shouldShowBanner(CONFIG, READY, 'tasks')).toBe(true);
    expect(shouldShowBanner(CONFIG, READY, 'lists')).toBe(true);
    expect(shouldShowBanner(CONFIG, READY, 'task-editor')).toBe(false);
  });

  it('hides banners with the master switch off or during onboarding', () => {
    expect(shouldShowBanner({ ...CONFIG, isAdsEnabled: false }, READY, 'tasks')).toBe(false);
    expect(shouldShowBanner(CONFIG, { ...READY, isOnboardingDone: false }, 'tasks')).toBe(false);
  });
});
