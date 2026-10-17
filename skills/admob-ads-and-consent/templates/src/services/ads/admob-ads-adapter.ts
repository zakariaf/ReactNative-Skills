// src/services/ads/admob-ads-adapter.ts
// With the consent adapters, the only files allowed to import react-native-google-mobile-ads.
// Deliberate: the classic create/load/show API behind AdsPort. Do not "upgrade" to the v17 hooks or
// pools: hooks tie ads to a component's lifetime and pools preload (on Android they also initialise
// the SDK) before consent; the app preloads at quiet moments and paces ads in pure code
// (ad-policy.ts). Created only through createAdsPort (ads-factory.ts) in the composition root.
import { createElement, useSyncExternalStore } from 'react';
import mobileAds, {
  AdEventType,
  BannerAd,
  BannerAdSize,
  InterstitialAd,
  MaxAdContentRating,
  RewardedAd,
  RewardedAdEventType,
  TestIds,
} from 'react-native-google-mobile-ads';

import { attemptAsync } from '@/core/result';

import type {
  AdsInitFailure,
  AdsPort,
  AdUnitIds,
  BannerSlotProps,
  FullscreenResult,
  RewardedStatus,
  RewardResult,
} from './ads-port';
import type { Result } from '@/core/result';
import type { ReactNode } from 'react';
import type { AdErrorPayload } from 'react-native-google-mobile-ads';

/** An ad error as the SDK reports it: branch on phase, then reason (never the deprecated code). */
export type AdFailure = Error & AdErrorPayload;

/** What the adapter needs. */
export type AdmobAdsOptions = {
  /** 'test': Google's test units (ADS_MODE=test); live builds pass the app's own units. */
  readonly units: AdUnitIds | 'test';
  /** The error log (the raw SDK error); never shown to the user. */
  readonly onAdError: (error: unknown) => void;
};

/** Google's test units (ADS_MODE=test), platform-aware. Never type test IDs anywhere else. */
export const ADMOB_TEST_UNITS: AdUnitIds = {
  banner: TestIds.ADAPTIVE_BANNER,
  interstitial: TestIds.INTERSTITIAL,
  rewarded: TestIds.REWARDED,
};

type Cell<T> = { readonly get: () => T; readonly set: (value: T) => void };
/** A cell whose listeners hear every change (useSyncExternalStore's subscribe). */
type WatchedCell<T> = Cell<T> & {
  readonly subscribe: (listener: () => void) => () => void;
};

function cell<T>(initial: T): Cell<T> {
  let value = initial;
  return { get: () => value, set: (next) => (value = next) };
}

// Load-phase no-fill is routine inventory; show-phase failures and real errors are logged.
function reportAdError(error: AdFailure, loading: Loading): void {
  const isNoFill = error.reason === 'no-fill' || error.reason === 'mediation-no-fill';
  if (error.phase === 'show' || !isNoFill) loading.onAdError(error);
}

function showInterstitial(
  slot: Cell<InterstitialAd | null>,
  onError: (error: unknown) => void,
): Promise<FullscreenResult> {
  const ad = slot.get();
  if (ad?.loaded !== true) return Promise.resolve('unavailable');
  slot.set(null);
  return new Promise((resolve) => {
    const settle = (result: FullscreenResult): void => {
      ad.destroy();
      resolve(result);
    };
    ad.addAdEventListener(AdEventType.CLOSED, () => {
      settle('shown');
    });
    // A failed presentation arrives only as ERROR (phase 'show'): show() has already resolved and
    // CLOSED never comes, so without this listener media would stay suspended and the caller stuck.
    ad.addAdEventListener(AdEventType.ERROR, () => {
      settle('unavailable');
    });
    ad.show().catch((error: unknown) => {
      onError(error); // not loaded, already showing or declined: unexpected after the loaded check
      settle('unavailable');
    });
  });
}

function showRewarded(
  slot: Cell<RewardedAd | null>,
  status: WatchedCell<RewardedStatus>,
  onError: (error: unknown) => void,
): Promise<RewardResult> {
  const ad = slot.get();
  if (ad?.loaded !== true) return Promise.resolve('unavailable');
  slot.set(null);
  status.set('unavailable'); // shown once; ad-moments starts the next preload after it closes
  const earned = cell(false);
  return new Promise((resolve) => {
    const settle = (result: RewardResult): void => {
      ad.destroy();
      resolve(result);
    };
    ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
      earned.set(true); // grant ONLY on this event, never on CLOSED alone
    });
    ad.addAdEventListener(AdEventType.CLOSED, () => {
      settle(earned.get() ? 'rewarded' : 'dismissed');
    });
    // Failed presentation: ERROR (phase 'show') and no CLOSED; see showInterstitial.
    ad.addAdEventListener(AdEventType.ERROR, () => {
      settle(earned.get() ? 'rewarded' : 'unavailable');
    });
    ad.show().catch((error: unknown) => {
      onError(error);
      settle('unavailable');
    });
  });
}

type Loading = {
  readonly units: AdUnitIds;
  readonly onAdError: (error: unknown) => void;
  readonly isInitialized: Cell<boolean>;
};

type ReadyBannerProps = BannerSlotProps & {
  readonly unitId: string;
  readonly isInitialized: WatchedCell<boolean>;
};

/**
 * The native banner requests its ad as it mounts, so it mounts only after initialize (consent and
 * the ATT answer come before it); the slot re-renders when initialize finishes.
 */
function ReadyBanner({ unitId, isInitialized, onLoaded, onFailed }: ReadyBannerProps): ReactNode {
  const isReady = useSyncExternalStore(isInitialized.subscribe, isInitialized.get);
  if (!isReady) return null;
  return createElement(BannerAd, {
    unitId,
    size: BannerAdSize.LARGE_ANCHORED_ADAPTIVE_BANNER,
    onAdLoaded: onLoaded,
    onAdFailedToLoad: onFailed,
  });
}

// Ads load only after initialize (which follows consent): an earlier preload starts nothing.
function preloadInterstitial(slot: Cell<InterstitialAd | null>, loading: Loading): void {
  if (!loading.isInitialized.get() || slot.get() !== null) return;
  const ad = InterstitialAd.createForAdRequest(loading.units.interstitial);
  slot.set(ad);
  ad.addAdEventListener(AdEventType.ERROR, (error) => {
    reportAdError(error, loading);
    ad.destroy();
    slot.set(null);
  });
  ad.load();
}

// 'loading' from here until LOADED ('ready') or a load error ('unavailable' until the next preload).
function preloadRewarded(
  slot: Cell<RewardedAd | null>,
  loading: Loading,
  status: WatchedCell<RewardedStatus>,
): void {
  if (!loading.isInitialized.get() || slot.get() !== null) return;
  const ad = RewardedAd.createForAdRequest(loading.units.rewarded);
  slot.set(ad);
  status.set('loading');
  ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
    status.set('ready');
  });
  ad.addAdEventListener(AdEventType.ERROR, (error) => {
    reportAdError(error, loading);
    ad.destroy();
    slot.set(null);
    status.set('unavailable');
  });
  ad.load();
}

/**
 * The request configuration, set before initialize. It must match contracts/ads.json "audience" and
 * the AdMob console's maximum content rating (check-ads rule content-rating). A general audience:
 * the rating only, no child-directed or under-age tags. A child-directed app sets
 * maxAdContentRating: MaxAdContentRating.G, tagForChildDirectedTreatment: true and
 * tagForUnderAgeOfConsent: true here, and records "audience": "child-directed".
 * Keep those two deprecated tags and never ageRestrictedTreatment (verified in the
 * react-native-google-mobile-ads 17.2.0 source on 2026-10-10): the enum sends "child" but the
 * Android modules match only "CHILD", so Android drops it silently. Re-verify on every upgrade of
 * the package (references/consent-flow.md, Audience).
 */
const REQUEST_CONFIGURATION = { maxAdContentRating: MaxAdContentRating.PG };

const INIT_FAILED: AdsInitFailure = { kind: 'ads-init-failed' };

type Initialization = {
  readonly running: Cell<Promise<Result<true, AdsInitFailure>> | null>;
  readonly isInitialized: Cell<boolean>;
};

// The SDK's rejection is recorded raw and becomes a failure value; a failed run is forgotten, so
// the next caller tries again.
async function initializeSdk(
  init: Initialization,
  onError: (error: unknown) => void,
): Promise<Result<true, AdsInitFailure>> {
  const result = await attemptAsync(
    async () => {
      await mobileAds().setRequestConfiguration(REQUEST_CONFIGURATION);
      await mobileAds().initialize();
      return true as const;
    },
    (thrown) => {
      onError(thrown);
      return INIT_FAILED;
    },
  );
  if (result.ok) init.isInitialized.set(true);
  else init.running.set(null);
  return result;
}

// One initialisation: a caller that arrives while it runs (or after) shares its result.
function initializeOnce(
  init: Initialization,
  onError: (error: unknown) => void,
): Promise<Result<true, AdsInitFailure>> {
  const current = init.running.get();
  if (current !== null) return current;
  const started = initializeSdk(init, onError);
  init.running.set(started);
  return started;
}

/** A cell that tells its listeners about every change (and nothing for a repeated value). */
function watchedCell<T>(initial: T): WatchedCell<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (next === value) return;
      value = next;
      listeners.forEach((listener) => {
        listener();
      });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The AdMob adapter: nothing touches the SDK before initialize(). */
export function createAdmobAdsAdapter(options: AdmobAdsOptions): AdsPort {
  const units = options.units === 'test' ? ADMOB_TEST_UNITS : options.units;
  const interstitial = cell<InterstitialAd | null>(null);
  const rewarded = cell<RewardedAd | null>(null);
  const isInitialized = watchedCell(false);
  const init: Initialization = {
    running: cell<Promise<Result<true, AdsInitFailure>> | null>(null),
    isInitialized,
  };
  const loading: Loading = { units, onAdError: options.onAdError, isInitialized };
  // 'unavailable' until the first preload after initialize.
  const status = watchedCell<RewardedStatus>('unavailable');
  return {
    initialize: () => initializeOnce(init, options.onAdError),
    preloadInterstitial: () => {
      preloadInterstitial(interstitial, loading);
    },
    preloadRewarded: () => {
      preloadRewarded(rewarded, loading, status);
    },
    rewardedStatus: status.get,
    subscribeRewardedStatus: status.subscribe,
    showInterstitial: () => showInterstitial(interstitial, options.onAdError),
    showRewarded: () => showRewarded(rewarded, status, options.onAdError),
    renderBanner: ({ onLoaded, onFailed }) =>
      createElement(ReadyBanner, {
        unitId: units.banner,
        isInitialized,
        onLoaded,
        onFailed,
      }),
  };
}
