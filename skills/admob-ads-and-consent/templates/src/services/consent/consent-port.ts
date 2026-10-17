// src/services/consent/consent-port.ts
// Owned by the admob-ads-and-consent skill (one canonical copy; analytics-and-consent ships the
// same bytes and reads only TrackingConsent). The app's view of consent: Google's User Messaging
// Platform (UMP) for the GDPR/TCF and US-state messages, and Apple's App Tracking Transparency (ATT)
// prompt (general audience only; a child-directed app never asks it).

/** What the latest consent answer allows. */
export type ConsentInfo = {
  /** True once Google's UMP says ads may be requested (consent given, or none required here). */
  readonly canRequestAds: boolean;
  /**
   * True where the app must offer a privacy-options entry point (Google requires a visible
   * "Ad privacy choices" item wherever this is true); hidden, never greyed out, otherwise.
   */
  readonly isPrivacyOptionsRequired: boolean;
};

/**
 * Apple's App Tracking Transparency answer. Only 'authorized' lets the ads SDK read the IDFA; every
 * other status still serves ads, without it. 'unavailable': not iOS, ads off, or the status could
 * not be read. 'restricted' exists for adapters that can tell it apart (Expo reports it as denied).
 */
export type TrackingStatus =
  'authorized' | 'denied' | 'restricted' | 'not-determined' | 'unavailable';

/**
 * Consent behind a port: one adapter (admob-consent-adapter.ts), chosen per ADS_MODE by
 * createConsentPort (consent-factory.ts); the fake is fake-consent.ts. No method ever rejects:
 * failures go to the adapter's onError and answer the cached state.
 */
export type ConsentPort = {
  /** Every launch (ads enabled, no Premium). Offline: the last session's answer. */
  readonly refresh: () => Promise<ConsentInfo>;
  /** Google's form, only where it is required. Offline: the cached answer. */
  readonly showFormIfRequired: () => Promise<ConsentInfo>;
  /** The app's "Ad privacy choices" entry point. */
  readonly showPrivacyOptions: () => Promise<ConsentInfo>;
  /**
   * After Google's form, before the first ad request: Apple's system prompt, only while the status
   * is not-determined and the app is active; otherwise the status as it is.
   */
  readonly requestTracking: () => Promise<TrackingStatus>;
};

/**
 * The ATT half of the port: expo-tracking-consent-adapter.ts for a general audience. A
 * child-directed app passes none (Apple's guideline 1.3: Kids Category apps do not implement ATT),
 * and the AdMob consent adapter then answers 'unavailable' without asking.
 */
export type TrackingConsent = Pick<ConsentPort, 'requestTracking'>;
