// src/config/ad-pacing.ts
// The app's ad pacing: configuration, never hard-coded in the policy. Defaults follow a gentle
// pacing (3 finished breaks before the first interstitial, then at least 3 minutes and 2 breaks
// between two); raise them freely, and keep them at or above contracts/ads.json "pacingFloors"
// (check-ads rule policy-numbers). isAdsEnabled is the app's master switch; an ADS_MODE=off build
// turns ads off on top of it.
import type { AdPolicyConfig } from '@/services/ads/ad-policy';

/** The pacing every ad decision reads (AdsProvider combines isAdsEnabled with the ads mode). */
export const AD_PACING: AdPolicyConfig = {
  isAdsEnabled: true,
  minBreaksBeforeFirst: 3,
  minMsBetweenInterstitials: 180_000,
  minBreaksBetween: 2,
  bannerScreens: ['tasks'],
};
