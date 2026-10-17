// src/services/ads/ads-factory.ts
// Chooses the AdsPort from expo.extra (readAdsExtraForBinary): off -> a port that never touches an
// SDK, test -> the AdMob adapter with Google's test units, live -> the AdMob adapter with this
// platform's units.
// The composition root passes the adapter as a function (it alone imports adapters), so an off build
// never even creates one.
import { ok } from '@/core/result';

import type { AdsPort, AdUnitIds } from './ads-port';
import type { AdsExtra } from './read-ads-extra';

/** What the factory needs besides the build's facts. */
export type AdsPortOptions = {
  /** The platform this binary runs on (Platform.OS in the composition root). */
  readonly platform: 'ios' | 'android';
  /** Builds the AdMob adapter: 'test' for Google's test units, else the live units. */
  readonly createAdmob: (units: AdUnitIds | 'test') => AdsPort;
};

/**
 * The port of an ads-off build (screenshots, E2E, the runtime network audit, ads switched off):
 * every slot stays empty, nothing is ever requested, the rewarded status stays 'unavailable'.
 */
function createDisabledAds(): AdsPort {
  return {
    initialize: () => Promise.resolve(ok(true)),
    preloadInterstitial: () => undefined,
    preloadRewarded: () => undefined,
    rewardedStatus: () => 'unavailable',
    subscribeRewardedStatus: () => () => undefined,
    showInterstitial: () => Promise.resolve('unavailable'),
    showRewarded: () => Promise.resolve('unavailable'),
    renderBanner: () => null,
  };
}

/** The app's one AdsPort. A live build without this platform's units throws (an app.config bug). */
export function createAdsPort(extra: AdsExtra, options: AdsPortOptions): AdsPort {
  if (extra.adsMode === 'off') return createDisabledAds();
  if (extra.adsMode === 'test') return options.createAdmob('test');
  const units = extra.adUnits?.[options.platform];
  if (units === undefined) {
    throw new Error(`ADS_MODE=live without expo.extra.adUnits.${options.platform} (app.config.ts)`);
  }
  return options.createAdmob(units);
}
