// src/services/consent/admob-consent-adapter.ts
// Owned by the admob-ads-and-consent skill (canonical copy). Google UMP through
// react-native-google-mobile-ads, and Apple's App Tracking Transparency prompt through the `tracking`
// option (expo-tracking-consent-adapter.ts, the only importer of expo-tracking-transparency; null in
// a child-directed app, which never asks). The form's content comes from the AdMob console (the
// published GDPR/TCF message); the app only decides WHEN it appears. No IDFA explainer message is
// published in the console: UMP would then run its own ATT flow beside this one. Created only
// through createConsentPort (consent-factory.ts).
import {
  AdsConsent,
  AdsConsentDebugGeography,
  AdsConsentPrivacyOptionsRequirementStatus,
} from 'react-native-google-mobile-ads';

import type { ConsentInfo, ConsentPort, TrackingConsent } from './consent-port';
import type { AdsConsentInfo } from 'react-native-google-mobile-ads';

/** The consent geography a test build asks UMP to assume. */
export type DebugGeography = 'eea' | 'other';

/** What the adapter needs. Store builds pass only tracking and onError. */
export type AdmobConsentOptions = {
  /**
   * Test builds only, set through the test-only debug services: UMP answers as for a user in the
   * EEA (the form) or elsewhere, on any network. A store build never passes it (check-ads rule
   * debug-geography-test-only).
   */
  readonly debugGeography?: DebugGeography;
  /** Test builds only: UMP test devices (a simulator or emulator is one already). */
  readonly testDeviceIdentifiers?: readonly string[];
  /**
   * Apple's ATT prompt: createExpoTrackingConsentAdapter({ onError }) for a general audience; null
   * for a child-directed app (requestTracking answers 'unavailable' and asks nothing).
   */
  readonly tracking: TrackingConsent | null;
  /** The error log: consent failures are recorded, never shown. */
  readonly onError: (error: unknown) => void;
};

const GEOGRAPHY = {
  eea: AdsConsentDebugGeography.EEA,
  other: AdsConsentDebugGeography.OTHER,
} as const;

/** requestInfoUpdate's debug settings: none in a store build. */
function debugSettings(options: AdmobConsentOptions): {
  readonly debugGeography?: number;
  readonly testDeviceIdentifiers?: string[];
} {
  const { debugGeography: geography, testDeviceIdentifiers: devices } = options;
  return {
    ...(geography === undefined ? {} : { debugGeography: GEOGRAPHY[geography] }),
    ...(devices === undefined ? {} : { testDeviceIdentifiers: [...devices] }),
  };
}

function toInfo(info: AdsConsentInfo): ConsentInfo {
  return {
    canRequestAds: info.canRequestAds,
    isPrivacyOptionsRequired:
      info.privacyOptionsRequirementStatus === AdsConsentPrivacyOptionsRequirementStatus.REQUIRED,
  };
}

// Nothing known at all (the cached read failed too): no ads, no privacy entry.
const UNKNOWN: ConsentInfo = { canRequestAds: false, isPrivacyOptionsRequired: false };

async function cachedInfo(onError: (error: unknown) => void): Promise<ConsentInfo> {
  try {
    return toInfo(await AdsConsent.getConsentInfo());
  } catch (error) {
    onError(error);
    return UNKNOWN;
  }
}

// Google: when the update fails, the previous session's canRequestAds still applies.
async function withCachedFallback(
  action: () => Promise<AdsConsentInfo>,
  onError: (error: unknown) => void,
): Promise<ConsentInfo> {
  try {
    return toInfo(await action());
  } catch (error) {
    onError(error);
    return cachedInfo(onError);
  }
}

/** The AdMob consent adapter: UMP for consent, the `tracking` option for ATT. */
export function createAdmobConsentAdapter(options: AdmobConsentOptions): ConsentPort {
  const requestOptions = debugSettings(options);
  const { tracking } = options;
  return {
    refresh: () =>
      withCachedFallback(() => AdsConsent.requestInfoUpdate(requestOptions), options.onError),
    showFormIfRequired: () =>
      withCachedFallback(() => AdsConsent.loadAndShowConsentFormIfRequired(), options.onError),
    showPrivacyOptions: () =>
      withCachedFallback(() => AdsConsent.showPrivacyOptionsForm(), options.onError),
    requestTracking: () =>
      tracking === null ? Promise.resolve('unavailable') : tracking.requestTracking(),
  };
}
