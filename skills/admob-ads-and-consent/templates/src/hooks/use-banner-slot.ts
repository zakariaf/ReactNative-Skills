// src/hooks/use-banner-slot.ts
// A banner screen's slot: what AdBannerSlot draws and whether it may show. A focused banner screen
// is an ad moment: the consent moment prepares ads (primer and form where required, then ATT) only
// while one is focused. Expo Router's Stack and Tabs keep a screen mounted under every screen pushed
// over it, so mounting is not enough: the model hook passes useIsFocused() (expo-router; React
// Navigation: @react-navigation/native), the moment is released on blur, and an unfocused slot
// unmounts its banner. Call it in the screen's model hook; never build isAllowed by hand.
import { useEffect } from 'react';

import { shouldShowBanner } from '@/services/ads/ad-policy';
import { useAds } from '@/services/ads/ads-context';

import { useAdContext } from './use-ad-context';

import type { AdFacts } from './use-ad-context';
import type { AdsPort } from '@/services/ads/ads-port';

/** AdBannerSlot's renderBanner and isAllowed. */
export type BannerSlotModel = {
  readonly renderBanner: AdsPort['renderBanner'];
  readonly isAllowed: boolean;
};

const noBanner = (): null => null;

/**
 * The banner model of `screen` (one of the pacing's bannerScreens). `isScreenFocused` is
 * useIsFocused() of that screen: a screen covered by another one asks for no ad moment and shows
 * no banner.
 */
export function useBannerSlot(
  screen: string,
  facts: AdFacts,
  isScreenFocused: boolean,
): BannerSlotModel {
  const deps = useAds();
  const context = useAdContext(facts);
  const requestAdMoment = deps?.flow.requestAdMoment;
  // Allowed effect: tells an external flow an ad screen is focused; returns its release (on blur).
  useEffect(
    () => (isScreenFocused ? requestAdMoment?.() : undefined),
    [isScreenFocused, requestAdMoment],
  );
  if (deps === null) return { renderBanner: noBanner, isAllowed: false };
  return {
    renderBanner: deps.ads.renderBanner,
    isAllowed: isScreenFocused && shouldShowBanner(deps.config, context, screen),
  };
}
