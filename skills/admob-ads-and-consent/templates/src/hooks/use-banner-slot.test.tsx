// src/hooks/use-banner-slot.test.tsx — outside AdsProvider (a screen test) the slot never shows;
// inside it, the policy decides with the live facts, and only while the screen is focused: a screen
// pushed over the list (the list stays mounted below it) gets no consent moment and no banner.
import { act, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { AdsProvider } from '@/services/ads/ads-provider';
import { createFakeAds } from '@/services/ads/fake-ads';
import { createFakeConnectivity } from '@/services/connectivity/fake-connectivity';
import { createFakeConsent } from '@/services/consent/fake-consent';
import { flushMicrotasks } from '@test/flush-microtasks';
import { renderHookWithProviders, renderWithProviders } from '@test/render-with-providers';

import { useBannerSlot } from './use-banner-slot';

import type { AdFacts } from './use-ad-context';
import type { FakeConnectivity } from '@/services/connectivity/fake-connectivity';
import type { ConsentInfo } from '@/services/consent/consent-port';
import type { ReactElement, ReactNode } from 'react';

const FACTS: AdFacts = { isPremium: false, isOnboardingDone: true, breaksCompletedTotal: 0 };
const ALLOWED = { canRequestAds: true, isPrivacyOptionsRequired: false };
const REQUIRED = { canRequestAds: false, isPrivacyOptionsRequired: true };
const PACING = {
  isAdsEnabled: true,
  minBreaksBeforeFirst: 3,
  minMsBetweenInterstitials: 180_000,
  minBreaksBetween: 2,
  bannerScreens: ['tasks'],
};

type ProbeProps = {
  readonly screenName: string;
  readonly facts: AdFacts;
  readonly isFocused: boolean;
};

function Probe({ screenName, facts, isFocused }: ProbeProps): ReactNode {
  const banner = useBannerSlot(screenName, facts, isFocused);
  return <View testID={banner.isAllowed ? 'probe.banner' : 'probe.no-banner'} />;
}

type Setup = {
  readonly connectivity: FakeConnectivity;
  readonly log: string[];
  readonly tree: (isFocused: boolean) => ReactElement;
};

function setup(screenName: string, isOnline: boolean, afterRefresh: ConsentInfo): Setup {
  const connectivity = createFakeConnectivity(isOnline);
  const log: string[] = [];
  const ads = createFakeAds({ log });
  const consent = createFakeConsent({
    afterRefresh,
    afterForm: ALLOWED,
    tracking: 'not-determined',
    log,
  });
  const tree = (isFocused: boolean): ReactElement => (
    <AdsProvider
      ads={ads}
      consent={consent}
      connectivity={connectivity}
      adsMode="test"
      pacing={PACING}
      isPremium={FACTS.isPremium}
      isOnboardingDone={FACTS.isOnboardingDone}
      savedCanRequestAds={null}
      onConsent={jest.fn()}
      onError={jest.fn()}
    >
      <Probe screenName={screenName} facts={FACTS} isFocused={isFocused} />
    </AdsProvider>
  );
  return { connectivity, log, tree };
}

async function renderInProvider(screenName: string, isOnline = true) {
  const parts = setup(screenName, isOnline, ALLOWED);
  const view = await renderWithProviders(parts.tree(true));
  await act(flushMicrotasks);
  return { ...parts, view };
}

describe('useBannerSlot', () => {
  it('shows no banner outside AdsProvider', async () => {
    const { result } = await renderHookWithProviders(() => useBannerSlot('tasks', FACTS, true));
    expect(result.current.isAllowed).toBe(false);
    expect(result.current.renderBanner({ onLoaded: jest.fn(), onFailed: jest.fn() })).toBeNull();
  });

  it('shows the banner on a declared, focused screen once ads are prepared', async () => {
    await renderInProvider('tasks');
    expect(screen.getByTestId('probe.banner')).toBeOnTheScreen();
  });

  it('hides it on an undeclared screen', async () => {
    await renderInProvider('task-editor');
    expect(screen.getByTestId('probe.no-banner')).toBeOnTheScreen();
  });

  it('hides it at once when the device goes offline', async () => {
    const { connectivity } = await renderInProvider('tasks');
    await act(() => {
      connectivity.setOnline(false);
    });
    expect(screen.getByTestId('probe.no-banner')).toBeOnTheScreen();
  });

  it('hides it while another screen covers the list', async () => {
    const { view, tree } = await renderInProvider('tasks');
    await view.rerender(tree(false));
    expect(screen.getByTestId('probe.no-banner')).toBeOnTheScreen();
  });

  it('releases the ad moment on blur: no form and no ATT over a pushed screen', async () => {
    // Launched offline on the list, where Google's form is required; then a task editor is pushed.
    const { connectivity, log, tree } = setup('tasks', false, REQUIRED);
    const view = await renderWithProviders(tree(true));
    await act(flushMicrotasks);
    await view.rerender(tree(false));

    await act(async () => {
      connectivity.setOnline(true);
      await flushMicrotasks();
    });

    expect(log).not.toContain('showFormIfRequired');
    expect(log).not.toContain('requestTracking');

    // Back on the list: the moment runs there.
    await view.rerender(tree(true));
    await act(flushMicrotasks);
    expect(log).toContain('showFormIfRequired');
    expect(log).toContain('requestTracking');
  });
});
