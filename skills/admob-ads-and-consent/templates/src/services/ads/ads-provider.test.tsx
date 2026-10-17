// src/services/ads/ads-provider.test.tsx — the consent moment in the app: the primer over an ad
// screen, then Google's form, Apple's ATT prompt and initialize; the banner only afterwards; nothing
// asked with ads off, for Premium or during onboarding.
import { act, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { useBannerSlot } from '@/hooks/use-banner-slot';
import { createFakeConnectivity } from '@/services/connectivity/fake-connectivity';
import { createFakeConsent } from '@/services/consent/fake-consent';
import { flushMicrotasks } from '@test/flush-microtasks';
import { renderWithProviders } from '@test/render-with-providers';

import { AdsProvider } from './ads-provider';
import { createFakeAds } from './fake-ads';

import type { AdsProviderProps } from './ads-provider';
import type { AdsMode } from '@/config/ads-config';
import type { ConsentInfo } from '@/services/consent/consent-port';
import type { ReactNode } from 'react';

const FACTS = { isPremium: false, isOnboardingDone: true, breaksCompletedTotal: 0 };
const PACING = {
  isAdsEnabled: true,
  minBreaksBeforeFirst: 3,
  minMsBetweenInterstitials: 180_000,
  minBreaksBetween: 2,
  bannerScreens: ['tasks'],
};

/** The focused task list's banner slot: it asks for the ad moment and shows whether it may load. */
function TasksProbe(): ReactNode {
  const banner = useBannerSlot('tasks', FACTS, true);
  return <View testID={banner.isAllowed ? 'probe.banner' : 'probe.no-banner'} />;
}

type Options = {
  readonly adsMode?: AdsMode;
  readonly isPremium?: boolean;
  readonly hasPrimer?: boolean;
};

/** A user past onboarding, online, where Google's form is required, ATT not yet answered. */
async function renderProvider(options: Options = {}) {
  const log: string[] = [];
  const saved: ConsentInfo[] = [];
  const primer: { continue: (() => void) | null } = { continue: null };
  const props: Omit<AdsProviderProps, 'children'> = {
    ads: createFakeAds({ log }),
    consent: createFakeConsent({
      afterRefresh: { canRequestAds: false, isPrivacyOptionsRequired: true },
      afterForm: { canRequestAds: true, isPrivacyOptionsRequired: true },
      tracking: 'not-determined',
      log,
    }),
    connectivity: createFakeConnectivity(true),
    adsMode: options.adsMode ?? 'test',
    pacing: PACING,
    isPremium: options.isPremium ?? false,
    isOnboardingDone: true,
    savedCanRequestAds: null,
    onConsent: (info) => saved.push(info),
    onError: jest.fn(),
    ...(options.hasPrimer === false
      ? {}
      : {
          renderPrimer: (onContinue: () => void) => {
            primer.continue = onContinue;
            return <View testID="consent.primer" />;
          },
        }),
  };
  await renderWithProviders(
    <AdsProvider {...props}>
      <TasksProbe />
    </AdsProvider>,
  );
  await act(flushMicrotasks);
  return { log, saved, primer };
}

describe('AdsProvider', () => {
  it('shows the primer, then the form, ATT and initialize, and only then allows the banner', async () => {
    const { log, saved, primer } = await renderProvider();
    expect(screen.getByTestId('consent.primer')).toBeOnTheScreen();
    // The primer is a modal layer: the screen below is hidden from accessibility while it shows.
    expect(
      screen.getByTestId('probe.no-banner', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    expect(log).toStrictEqual(['refresh']);

    await act(async () => {
      primer.continue?.();
      await flushMicrotasks();
    });

    expect(log).toStrictEqual([
      'refresh',
      'showFormIfRequired',
      'requestTracking',
      'initialize',
      'preloadInterstitial',
      'preloadRewarded',
    ]);
    expect(saved).toHaveLength(2);
    expect(screen.queryByTestId('consent.primer')).not.toBeOnTheScreen();
    expect(screen.getByTestId('probe.banner')).toBeOnTheScreen();
  });

  it("opens Google's form at once without a primer", async () => {
    const { log } = await renderProvider({ hasPrimer: false });
    expect(log).toStrictEqual([
      'refresh',
      'showFormIfRequired',
      'requestTracking',
      'initialize',
      'preloadInterstitial',
      'preloadRewarded',
    ]);
  });

  it.each([
    ['in an ADS_MODE=off build', { adsMode: 'off' }],
    ['for Premium', { isPremium: true }],
  ] as const)('asks neither Google nor Apple %s', async (_label, options) => {
    const { log } = await renderProvider(options);
    expect(log).toStrictEqual([]);
    expect(screen.queryByTestId('consent.primer')).not.toBeOnTheScreen();
    expect(screen.getByTestId('probe.no-banner')).toBeOnTheScreen();
  });
});
