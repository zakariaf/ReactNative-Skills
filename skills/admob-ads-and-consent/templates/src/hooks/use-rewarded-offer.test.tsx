// src/hooks/use-rewarded-offer.test.tsx — the offer follows the rewarded ad: loading, ready, gone;
// Premium makes it free; outside AdsProvider no ad is offered.
import { act, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { AdsProvider } from '@/services/ads/ads-provider';
import { createFakeAds } from '@/services/ads/fake-ads';
import { createFakeConnectivity } from '@/services/connectivity/fake-connectivity';
import { createFakeConsent } from '@/services/consent/fake-consent';
import { flushMicrotasks } from '@test/flush-microtasks';
import { renderHookWithProviders, renderWithProviders } from '@test/render-with-providers';

import { useRewardedOffer } from './use-rewarded-offer';

import type { AdFacts } from './use-ad-context';
import type { RewardedPerk } from '@/services/ads/rewarded-offer';
import type { ReactNode } from 'react';

const FACTS: AdFacts = { isPremium: false, isOnboardingDone: true, breaksCompletedTotal: 0 };
const PERK: RewardedPerk = { isAvailable: true, freeAllowanceLeft: 0, waitsWhileLoading: true };
const ALLOWED = { canRequestAds: true, isPrivacyOptionsRequired: false };

function Probe(): ReactNode {
  return <View testID={`offer.${useRewardedOffer(PERK, FACTS)}`} />;
}

describe('useRewardedOffer', () => {
  it('follows the rewarded ad from loading to ready to gone', async () => {
    const ads = createFakeAds({ rewardedStatus: 'loading' });
    await renderWithProviders(
      <AdsProvider
        ads={ads}
        consent={createFakeConsent({ afterRefresh: ALLOWED, afterForm: ALLOWED })}
        connectivity={createFakeConnectivity(true)}
        adsMode="live"
        pacing={{
          isAdsEnabled: true,
          minBreaksBeforeFirst: 3,
          minMsBetweenInterstitials: 180_000,
          minBreaksBetween: 2,
          bannerScreens: [],
        }}
        isPremium={false}
        isOnboardingDone
        savedCanRequestAds
        onConsent={jest.fn()}
        onError={jest.fn()}
      >
        <Probe />
      </AdsProvider>,
    );
    await act(flushMicrotasks);
    expect(screen.getByTestId('offer.loading')).toBeOnTheScreen();
    await act(() => {
      ads.setRewardedStatus('ready');
    });
    expect(screen.getByTestId('offer.watch-ad')).toBeOnTheScreen();
    await act(() => {
      ads.setRewardedStatus('unavailable');
    });
    expect(screen.getByTestId('offer.hidden')).toBeOnTheScreen();
  });

  it('offers no ad outside AdsProvider, but Premium and a free use stay free', async () => {
    const { result: plain } = await renderHookWithProviders(() => useRewardedOffer(PERK, FACTS));
    expect(plain.current).toBe('hidden');
    const { result: premium } = await renderHookWithProviders(() =>
      useRewardedOffer(PERK, { ...FACTS, isPremium: true }),
    );
    expect(premium.current).toBe('free');
    const { result: allowance } = await renderHookWithProviders(() =>
      useRewardedOffer({ ...PERK, freeAllowanceLeft: 1 }, FACTS),
    );
    expect(allowance.current).toBe('free');
  });
});
