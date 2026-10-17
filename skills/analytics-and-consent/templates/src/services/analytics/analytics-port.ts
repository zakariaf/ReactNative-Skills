// src/services/analytics/analytics-port.ts
// Product analytics behind a port. Features call AnalyticsPort.track() with an event from the typed
// catalog (analytics-events.ts); createAnalytics (create-analytics.ts) decides whether it leaves the
// device: only after the user said yes, only in a build whose analytics mode is on, and only through
// the one vendor adapter (<vendor>-analytics-adapter.ts), which is created lazily on the first event
// after consent. The fake is fake-analytics.ts.
import type { AnalyticsEvent } from './analytics-events';

/** A property value the catalog allows: an enum member, a boolean or a bucketed count. */
export type AnalyticsValue = string | number | boolean;

/** The properties of one event after the sanitizer: plain values only. */
export type AnalyticsProps = Readonly<Record<string, AnalyticsValue>>;

/** The user's saved answer. */
export type AnalyticsConsentChoice = 'granted' | 'denied';

/** What the app knows: no answer yet (or an answer to an older question), or the answer. */
export type AnalyticsConsentState = 'unknown' | AnalyticsConsentChoice;

/**
 * The vendor seam: the five calls the gate makes on an analytics SDK. One adapter per vendor
 * (posthog-analytics-adapter.ts, ...) implements it; it is the only file that imports the vendor
 * package. Every method may throw; createAnalytics catches and records.
 */
export type AnalyticsSdk = {
  /** Start sending (the user said yes). The adapter creates its client opted out. */
  readonly optIn: () => Promise<void>;
  /** Queue one event (the SDK batches and sends it). */
  readonly capture: (name: string, props: AnalyticsProps) => void;
  /** Send what is queued now (the app is going to the background). */
  readonly flush: () => Promise<void>;
  /** Stop capturing and remember the opt-out in the SDK's own storage (the gate calls it after reset). */
  readonly optOut: () => Promise<void>;
  /**
   * Forget the anonymous identity, the install or device id and the unsent event queue, so the next
   * yes starts under new ids and nothing captured before the no is sent. A vendor whose reset keeps
   * any of them by default is told to keep nothing (PostHog: reset([]) and clearing its queue).
   */
  readonly reset: () => void;
};

/** The app's analytics. No method throws or rejects: analytics never breaks a feature. */
export type AnalyticsPort = {
  /** Sends the event when consent, mode and catalog allow it; drops it silently otherwise. */
  readonly track: (event: AnalyticsEvent) => void;
  /** The saved answer ('unknown' before the user chose, or after the question changed). */
  readonly consent: () => AnalyticsConsentState;
  /** Saves the answer. 'granted' starts analytics; 'denied' stops it and forgets the identity. */
  readonly setConsent: (choice: AnalyticsConsentChoice) => void;
  /** Account deletion or "reset analytics": stop, forget the identity, clear the saved answer. */
  readonly forget: () => Promise<void>;
  /** Sends queued events now (call on the way to the background); nothing when off. */
  readonly flush: () => Promise<void>;
};
