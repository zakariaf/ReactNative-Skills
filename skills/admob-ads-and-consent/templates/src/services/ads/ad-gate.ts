// src/services/ads/ad-gate.ts
// Consent, then tracking, then initialize, then preload: nothing may request an ad before the user
// answered Google's consent form (where it is required) and Apple's App Tracking Transparency prompt
// (while not-determined). Where the form is required, the app's optional consent primer comes first:
// showIntro resolves when the user continues, and only then Google's form opens. Whatever the ATT
// answer, ads initialize and serve; without 'authorized' the ads SDK sends no IDFA, and nothing in
// the app depends on the answer.
import type { AdsPort } from './ads-port';
import type { ConsentInfo, ConsentPort } from '@/services/consent/consent-port';

/** The ports the gate drives. */
export type AdGateDeps = {
  readonly ads: AdsPort;
  readonly consent: ConsentPort;
  /** Saves canRequestAds and the privacy-entry flag (for the next launch and the settings row). */
  readonly onConsent: (info: ConsentInfo) => void;
};

/** prepareAds also needs the primer: it resolves when the user continues (at once without one). */
export type PrepareAdsDeps = AdGateDeps & { readonly showIntro: () => Promise<void> };

/** The facts that open or close the gate. */
export type AdGateInput = {
  readonly isPremium: boolean;
  readonly isAdsEnabled: boolean;
  readonly isOnboardingDone: boolean;
  readonly isOnline: boolean;
};

/** 1. At every launch: refresh the consent info. Never awaited by the first render. */
export async function refreshConsentAtLaunch(deps: AdGateDeps, input: AdGateInput): Promise<void> {
  if (input.isPremium || !input.isAdsEnabled) return;
  deps.onConsent(await deps.consent.refresh());
}

// Where consent is required: the primer, then Google's form.
async function consentThroughIntro(deps: PrepareAdsDeps): Promise<ConsentInfo> {
  await deps.showIntro();
  const info = await deps.consent.showFormIfRequired();
  deps.onConsent(info);
  return info;
}

/**
 * 2. Before the first ad is ever requested: refresh, (primer, form), ATT, initialize, preload.
 * Resolves false, asking nothing, for Premium, with ads off, during onboarding or offline (the
 * consent moment tries again when a fact changes), and false when consent allows no ads or the
 * SDK failed to initialize.
 */
export async function prepareAds(deps: PrepareAdsDeps, input: AdGateInput): Promise<boolean> {
  if (input.isPremium || !input.isAdsEnabled || !input.isOnboardingDone || !input.isOnline) {
    return false;
  }
  const known = await deps.consent.refresh();
  deps.onConsent(known);
  // Consent given before, or not required in this region: no primer and no form.
  const info = known.canRequestAds ? known : await consentThroughIntro(deps);
  if (!info.canRequestAds) return false;
  await deps.consent.requestTracking(); // after Google's form, before the SDK can request an ad
  const initialized = await deps.ads.initialize();
  if (!initialized.ok) return false; // recorded by the adapter; no ad loads without the SDK
  deps.ads.preloadInterstitial();
  deps.ads.preloadRewarded();
  return true;
}
