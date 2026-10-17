// src/services/ads/fake-ads.ts
// Jest only: a scripted AdsPort that records every call in order. Runtime code never imports it (an
// ADS_MODE=off build gets the disabled port from createAdsPort instead).
import { ok } from '@/core/result';

import type { AdsPort, FullscreenResult, RewardedStatus, RewardResult } from './ads-port';

/** What the fake answers until a test changes it. */
export type FakeAdsScript = {
  readonly rewardedStatus?: RewardedStatus;
  readonly interstitialResult?: FullscreenResult;
  readonly rewardResult?: RewardResult;
  /** A call log shared with other fakes (fake-consent.ts), to prove the order across ports. */
  readonly log?: string[];
};

/** The scripted port, its call log, and the ways a test moves it. */
export type FakeAds = AdsPort & {
  /** The call log, in order ('initialize', 'preloadInterstitial', ..., 'showRewarded'). */
  readonly calls: () => readonly string[];
  /** Moves the rewarded status (loading -> ready ...) and tells the subscribers. */
  readonly setRewardedStatus: (status: RewardedStatus) => void;
};

type StatusCell = Pick<FakeAds, 'rewardedStatus' | 'subscribeRewardedStatus' | 'setRewardedStatus'>;

/** The scripted status and its subscribers (useSyncExternalStore). */
function statusCell(initial: RewardedStatus): StatusCell {
  const listeners = new Set<() => void>();
  let status = initial;
  return {
    rewardedStatus: () => status,
    subscribeRewardedStatus: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setRewardedStatus: (next) => {
      status = next;
      listeners.forEach((listener) => {
        listener();
      });
    },
  };
}

/** An AdsPort for tests: 'ready', 'shown' and 'rewarded' unless the script says otherwise. */
export function createFakeAds(script: FakeAdsScript = {}): FakeAds {
  const calls = script.log ?? [];
  const record = (name: string): void => {
    calls.push(name);
  };
  return {
    ...statusCell(script.rewardedStatus ?? 'ready'),
    initialize: () => {
      record('initialize');
      return Promise.resolve(ok(true));
    },
    preloadInterstitial: () => {
      record('preloadInterstitial');
    },
    preloadRewarded: () => {
      record('preloadRewarded');
    },
    showInterstitial: () => {
      record('showInterstitial');
      return Promise.resolve(script.interstitialResult ?? 'shown');
    },
    showRewarded: () => {
      record('showRewarded');
      return Promise.resolve(script.rewardResult ?? 'rewarded');
    },
    renderBanner: () => null,
    calls: () => [...calls],
  };
}
