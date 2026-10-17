// src/services/consent/admob-consent-debug-adapter.ts
// Test builds only. Imported by nothing but the test-only entry (src/test-only-entry.ts, which
// production bundles drop through the test-only gate): resetting consent or opening the Ad Inspector
// changes consent behaviour for real users, so these calls never live in admob-consent-adapter.ts.
// Apple's tracking answer (ATT) has no reset: it comes back only after deleting the app, or through
// Settings > Privacy & Security > Tracking. resetConsent resets Google's UMP answer alone.
import mobileAds, { AdsConsent } from 'react-native-google-mobile-ads';

import type { AdsConsentUserChoices } from 'react-native-google-mobile-ads';

/** What a debug menu may do with consent. */
export type ConsentDebugTools = {
  /** Starts the UMP flow over on this device. */
  readonly resetConsent: () => void;
  /** The decoded TCF choices. */
  readonly readUserChoices: () => Promise<AdsConsentUserChoices>;
  /** Google's Ad Inspector: why an ad did not show (test units only). */
  readonly openAdInspector: () => Promise<void>;
};

/** The debug tools over the AdMob SDK (test builds only). */
export function createAdmobConsentDebugAdapter(): ConsentDebugTools {
  return {
    resetConsent: () => {
      AdsConsent.reset();
    },
    readUserChoices: () => AdsConsent.getUserChoices(),
    openAdInspector: () => mobileAds().openAdInspector(),
  };
}
