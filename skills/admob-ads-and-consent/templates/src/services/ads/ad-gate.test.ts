// src/services/ads/ad-gate.test.ts — refresh, primer, form, ATT, initialize, preload, in that order;
// a declined or restricted ATT answer still serves ads; nothing at all for Premium, offline, during
// onboarding or with ads off.
import { err } from '@/core/result';
import { createFakeConsent } from '@/services/consent/fake-consent';

import { prepareAds, refreshConsentAtLaunch } from './ad-gate';
import { createFakeAds } from './fake-ads';

import type { AdGateInput } from './ad-gate';
import type { ConsentInfo, TrackingStatus } from '@/services/consent/consent-port';

const GRANTED: ConsentInfo = { canRequestAds: true, isPrivacyOptionsRequired: true };
const DENIED: ConsentInfo = { canRequestAds: false, isPrivacyOptionsRequired: true };
const READY: AdGateInput = {
  isPremium: false,
  isAdsEnabled: true,
  isOnboardingDone: true,
  isOnline: true,
};
const PREPARED = ['requestTracking', 'initialize', 'preloadInterstitial', 'preloadRewarded'];

/**
 * afterRefresh DENIED: Google's form is required (a user in the EEA who has not answered). The ATT
 * status starts not-determined, and the user declines unless told otherwise.
 */
function setup(
  afterForm: ConsentInfo,
  afterRefresh: ConsentInfo = DENIED,
  tracking: TrackingStatus = 'not-determined',
) {
  const log: string[] = [];
  const seen: ConsentInfo[] = [];
  const consent = createFakeConsent({ afterRefresh, afterForm, tracking, log });
  const ads = createFakeAds({ rewardedStatus: 'unavailable', log });
  const showIntro = (): Promise<void> => {
    log.push('intro');
    return Promise.resolve();
  };
  const onConsent = (info: ConsentInfo): void => {
    seen.push(info);
  };
  return { log, seen, consent, deps: { ads, consent, onConsent, showIntro } };
}

describe('prepareAds', () => {
  it('shows the primer, the form, the ATT prompt, then initializes and preloads', async () => {
    const { log, seen, consent, deps } = setup(GRANTED);
    await expect(prepareAds(deps, READY)).resolves.toBe(true);
    expect(log).toStrictEqual(['refresh', 'intro', 'showFormIfRequired', ...PREPARED]);
    expect(seen).toStrictEqual([DENIED, GRANTED]);
    expect(consent.trackingPrompts()).toBe(1);
  });

  it.each(['denied', 'restricted', 'unavailable'] as const)(
    'initializes and preloads when tracking is %s too (ads without the IDFA)',
    async (status) => {
      const { log, consent, deps } = setup(GRANTED, GRANTED, status);
      await expect(prepareAds(deps, READY)).resolves.toBe(true);
      expect(log).toStrictEqual(['refresh', ...PREPARED]);
      expect(consent.trackingPrompts()).toBe(0); // Apple never asks twice
    },
  );

  it('shows no primer and no form where consent is not required, but still asks ATT first', async () => {
    const { log, consent, deps } = setup(GRANTED, GRANTED);
    await expect(prepareAds(deps, READY)).resolves.toBe(true);
    expect(log).toStrictEqual(['refresh', ...PREPARED]);
    expect(consent.trackingPrompts()).toBe(1);
  });

  it('preloads nothing and answers false when the SDK fails to initialize', async () => {
    const { log, deps } = setup(GRANTED, GRANTED, 'authorized');
    const failing = {
      ...deps.ads,
      initialize: () => {
        log.push('initialize');
        return Promise.resolve(err({ kind: 'ads-init-failed' } as const));
      },
    };
    await expect(prepareAds({ ...deps, ads: failing }, READY)).resolves.toBe(false);
    expect(log).toStrictEqual(['refresh', 'requestTracking', 'initialize']);
  });

  it('keeps the SDK uninitialized and asks no ATT when consent allows no ad requests', async () => {
    const { log, deps } = setup(DENIED);
    await expect(prepareAds(deps, READY)).resolves.toBe(false);
    expect(log).toStrictEqual(['refresh', 'intro', 'showFormIfRequired']);
  });

  it.each([
    ['during onboarding', { isOnboardingDone: false }],
    ['for Premium', { isPremium: true }],
    ['offline', { isOnline: false }],
    ['with ads off', { isAdsEnabled: false }],
  ] as const)('asks nothing %s', async (_label, change) => {
    const { log, deps } = setup(GRANTED);
    await expect(prepareAds(deps, { ...READY, ...change })).resolves.toBe(false);
    expect(log).toStrictEqual([]);
  });
});

describe('refreshConsentAtLaunch', () => {
  it('refreshes the consent info without showing any form, even during onboarding', async () => {
    const { log, seen, deps } = setup(GRANTED);
    await refreshConsentAtLaunch(deps, { ...READY, isOnboardingDone: false });
    expect(log).toStrictEqual(['refresh']);
    expect(seen).toStrictEqual([DENIED]);
  });

  it('asks nothing for Premium or with ads off', async () => {
    const { log, deps } = setup(GRANTED);
    await refreshConsentAtLaunch(deps, { ...READY, isPremium: true });
    await refreshConsentAtLaunch(deps, { ...READY, isAdsEnabled: false });
    expect(log).toStrictEqual([]);
  });
});
