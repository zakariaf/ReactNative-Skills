// src/services/create-device-services.ts
// The ads lines of the composition root (a shape: the app adds ads, consent, connectivity and the
// fullscreen gate to its Services type, to createDeviceServices and to createTestServices). Only this
// file imports the adapters; the factories decide per ads mode, so an ADS_MODE=off build never
// creates an AdMob adapter and never asks Google or Apple. The ads facts come from the running config
// checked against the binary's own id (an EAS Update made for another variant turns ads off). A
// child-directed app passes tracking: null and has no expo-tracking-consent-adapter.ts.
import * as Application from 'expo-application';
import { Platform } from 'react-native';

import { createAdmobAdsAdapter } from '@/services/ads/admob-ads-adapter';
import { createAdsPort } from '@/services/ads/ads-factory';
import { createFullscreenAdGate } from '@/services/ads/fullscreen-ad';
import { readAdsExtraForBinary } from '@/services/ads/read-ads-extra';
import { createSystemClockAdapter } from '@/services/clock/system-clock-adapter';
import { createExpoNetworkConnectivityAdapter } from '@/services/connectivity/expo-network-connectivity-adapter';
import { createAdmobConsentAdapter } from '@/services/consent/admob-consent-adapter';
import { createConsentPort } from '@/services/consent/consent-factory';
import { createExpoTrackingConsentAdapter } from '@/services/consent/expo-tracking-consent-adapter';
import { createMemoryErrorLogAdapter } from '@/services/error-log/memory-error-log-adapter';

import type { Services } from '@/services/services-context';

/** Creates every device adapter once and returns them as the app's Services. */
export function createDeviceServices(): Services {
  const clock = createSystemClockAdapter();
  const errorLog = createMemoryErrorLogAdapter({ clock });
  const onError = (error: unknown): void => {
    errorLog.record('service', error);
  };
  const adsExtra = readAdsExtraForBinary(Application.applicationId);
  return {
    clock,
    errorLog,
    connectivity: createExpoNetworkConnectivityAdapter({ errorLog }),
    fullscreenAd: createFullscreenAdGate(),
    ads: createAdsPort(adsExtra, {
      platform: Platform.OS === 'android' ? 'android' : 'ios',
      createAdmob: (units) => createAdmobAdsAdapter({ units, onAdError: onError }),
    }),
    consent: createConsentPort(adsExtra.adsMode, () =>
      createAdmobConsentAdapter({
        tracking: createExpoTrackingConsentAdapter({ onError }),
        onError,
      }),
    ),
  };
}
