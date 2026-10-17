// src/services/ads/ad-moments.ts
// The two moments a fullscreen ad may appear: when the user leaves a natural break they just
// finished (from that press handler, never from an effect), and when they chose to watch a rewarded
// ad. Both run inside runFullscreenAd and preload the next ad afterwards.
import { recordInterstitialShown } from './ad-history';
import { shouldShowInterstitial } from './ad-policy';
import { runFullscreenAd } from './fullscreen-ad';

import type { AdHistory, InterstitialRequest } from './ad-policy';
import type { AdsPort } from './ads-port';
import type { MediaLifecycle } from './fullscreen-ad';

/** The port and the app's media lifecycle. */
export type AdMomentDeps = { readonly ads: AdsPort; readonly lifecycle: MediaLifecycle };

/**
 * From the press handler that leaves a natural break ("Done" after a review). Returns the history
 * to save; the caller then navigates on. Always settles: the adapter resolves on CLOSED, ERROR or a
 * rejected show().
 */
export async function showInterstitialIfDue(
  deps: AdMomentDeps,
  request: InterstitialRequest,
): Promise<AdHistory> {
  if (!shouldShowInterstitial(request)) return request.history;
  const result = await runFullscreenAd(deps.lifecycle, deps.ads.showInterstitial);
  deps.ads.preloadInterstitial(); // the next one loads in the background
  return result === 'shown' ? recordInterstitialShown(request.trigger) : request.history;
}

/** "Watch an ad to ...": true only when the reward was earned (EARNED_REWARD). */
export async function earnRewardedPerk(deps: AdMomentDeps): Promise<boolean> {
  const result = await runFullscreenAd(deps.lifecycle, deps.ads.showRewarded);
  deps.ads.preloadRewarded();
  return result === 'rewarded';
}
