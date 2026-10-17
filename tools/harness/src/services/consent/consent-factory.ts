// src/services/consent/consent-factory.ts
// Owned by the admob-ads-and-consent skill (canonical copy). Chooses the ConsentPort from the
// build's ads mode (expo.extra.adsMode, read by readAdsExtraForBinary). An ADS_MODE=off build
// (screenshots, E2E, the runtime network audit, an app with ads switched off) never touches Google's
// UMP (its consent-info update is a network request from the app process) and never shows Apple's
// tracking prompt: no ad could use the IDFA. The composition root passes the adapter as a function,
// so only it imports the adapter, and an off build never even creates one.
import type { ConsentInfo, ConsentPort } from './consent-port';

/** The build's ads mode (the same three values as AdsMode in src/config/ads-config.ts). */
export type ConsentAdsMode = 'off' | 'test' | 'live';

// No ads: nothing may be requested and there is no "Ad privacy choices" entry to show.
const NO_ADS: ConsentInfo = { canRequestAds: false, isPrivacyOptionsRequired: false };

/** The port of an ads-off build: it answers without calling any SDK. */
function createDisabledConsent(): ConsentPort {
  return {
    refresh: () => Promise.resolve(NO_ADS),
    showFormIfRequired: () => Promise.resolve(NO_ADS),
    showPrivacyOptions: () => Promise.resolve(NO_ADS),
    requestTracking: () => Promise.resolve('unavailable'),
  };
}

/**
 * The app's one ConsentPort: `createAdmob` (a call of createAdmobConsentAdapter, written in the
 * composition root) runs only in test and live builds.
 */
export function createConsentPort(
  adsMode: ConsentAdsMode,
  createAdmob: () => ConsentPort,
): ConsentPort {
  return adsMode === 'off' ? createDisabledConsent() : createAdmob();
}
