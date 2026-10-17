// src/services/ads/ads-port.ts
// The app's view of an ads SDK. Only admob-ads-adapter.ts touches the real SDK; createAdsPort
// (ads-factory.ts) picks the port for the build's ads mode; fake-ads.ts is the test fake.
import type { Result } from '@/core/result';
import type { ReactNode } from 'react';

/** The three ad units of one platform. */
export type AdUnitIds = {
  readonly banner: string;
  readonly interstitial: string;
  readonly rewarded: string;
};

/** What a fullscreen interstitial did. */
export type FullscreenResult = 'shown' | 'unavailable';

/** What a rewarded ad did: only 'rewarded' grants the reward. */
export type RewardResult = 'rewarded' | 'dismissed' | 'unavailable';

/**
 * Where the rewarded ad stands: 'loading' from the start of a preload until LOADED or a load error;
 * 'ready' after LOADED; 'unavailable' after a load error until the next preload starts, after the
 * loaded ad was shown, with ads off and before initialize. So a hidden offer always means the ad
 * cannot come, never that it is still on its way.
 */
export type RewardedStatus = 'loading' | 'ready' | 'unavailable';

/** initialize() failed (offline right after consent, an SDK error): a later call tries again. */
export type AdsInitFailure = { readonly kind: 'ads-init-failed' };

/** What the banner slot hands to renderBanner. */
export type BannerSlotProps = {
  /** The slot stays collapsed until this fires (no empty box). */
  readonly onLoaded: () => void;
  /** A failed load is silent: the slot collapses again. */
  readonly onFailed: () => void;
};

/** Ads behind a port. Nothing here ever rejects or shows an error to the user. */
export type AdsPort = {
  /**
   * After consent and the ATT answer: request configuration, then SDK initialize. Idempotent: an
   * overlapping call shares the running one; after a failure the next call tries again.
   */
  readonly initialize: () => Promise<Result<true, AdsInitFailure>>;
  readonly preloadInterstitial: () => void;
  readonly preloadRewarded: () => void;
  readonly rewardedStatus: () => RewardedStatus;
  /** Calls `listener` when rewardedStatus() changes (useSyncExternalStore's subscribe). */
  readonly subscribeRewardedStatus: (listener: () => void) => () => void;
  /** Resolves when the ad closed or failed (or at once with 'unavailable'). Never rejects. */
  readonly showInterstitial: () => Promise<FullscreenResult>;
  /** Resolves 'rewarded' only after the SDK's EARNED_REWARD. Never rejects. */
  readonly showRewarded: () => Promise<RewardResult>;
  readonly renderBanner: (props: BannerSlotProps) => ReactNode;
};
