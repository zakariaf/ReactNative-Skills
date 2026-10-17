// src/services/ads/use-consent-moment.ts
// AdsProvider's hook: one ConsentMomentFlow per app run, fed with the gate's live facts, the consent
// refresh once per launch, and what the primer overlay needs. The gate's isAdsEnabled is the build's
// ads mode and the app's switch, so an ADS_MODE=off build (screenshots, E2E) never asks Google.
import { useEffect, useState, useSyncExternalStore } from 'react';

import { createConsentMomentFlow } from './consent-moment-flow';

import type { AdPolicyConfig } from './ad-policy';
import type { AdsDeps } from './ads-context';
import type { AdsPort } from './ads-port';
import type { AdsMode } from '@/config/ads-config';
import type { ConnectivityPort } from '@/services/connectivity/connectivity-port';
import type { ConsentInfo, ConsentPort } from '@/services/consent/consent-port';

/** What the app hands to AdsProvider. */
export type ConsentMomentOptions = {
  readonly ads: AdsPort;
  readonly consent: ConsentPort;
  readonly connectivity: ConnectivityPort;
  /** readAdsExtraForBinary(Application.applicationId).adsMode: the composition root's mode. */
  readonly adsMode: AdsMode;
  /** AD_PACING (src/config/ad-pacing.ts). */
  readonly pacing: AdPolicyConfig;
  /** The Premium entitlement: no consent, no ads. */
  readonly isPremium: boolean;
  /** No consent moment before onboarding is done. */
  readonly isOnboardingDone: boolean;
  /** The answer a previous launch saved (null: never asked). */
  readonly savedCanRequestAds: boolean | null;
  /** Saves each answer (skip the write when it equals the saved one). */
  readonly onConsent: (info: ConsentInfo) => void;
  /** The error log: consent failures are recorded, never shown. */
  readonly onError: (error: unknown) => void;
  /** False when the app shows no primer before Google's form. */
  readonly hasPrimer: boolean;
};

/** What AdsProvider draws and hands down. */
export type ConsentMomentModel = {
  readonly deps: AdsDeps;
  readonly isIntroShown: boolean;
  /** The primer's continue action: Google's form opens next. */
  readonly onContinue: () => void;
};

/** Runs the consent moment for this app run. */
export function useConsentMoment(options: ConsentMomentOptions): ConsentMomentModel {
  const { ads, consent, connectivity, adsMode, pacing, isPremium, isOnboardingDone } = options;
  const [flow] = useState(() =>
    createConsentMomentFlow({
      ads,
      consent,
      hasPrimer: options.hasPrimer,
      savedCanRequestAds: options.savedCanRequestAds,
      onConsent: options.onConsent,
      onError: options.onError,
    }),
  );
  const isAdsEnabled = pacing.isAdsEnabled && adsMode !== 'off';
  const [config] = useState(() => ({ ...pacing, isAdsEnabled }));
  const snapshot = useSyncExternalStore(flow.subscribe, flow.getSnapshot);
  const isOnline = useSyncExternalStore(connectivity.subscribe, connectivity.isOnline);
  // Allowed effect: hands the gate's facts to an external flow (online again retries the moment).
  useEffect(() => {
    flow.updateInput({ isPremium, isAdsEnabled, isOnboardingDone, isOnline });
  }, [flow, isPremium, isAdsEnabled, isOnboardingDone, isOnline]);
  // Allowed effect: one call into an external system after mount (Google's consent refresh).
  useEffect(() => {
    flow.refreshAtLaunch();
  }, [flow]);
  const [deps] = useState((): AdsDeps => ({ ads, connectivity, flow, config }));
  return { deps, isIntroShown: snapshot.isIntroShown, onContinue: flow.continueToForm };
}
