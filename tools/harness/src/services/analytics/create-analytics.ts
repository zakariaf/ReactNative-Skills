// src/services/analytics/create-analytics.ts
// The consent gate: the app's one AnalyticsPort. Nothing leaves the device until the user said yes
// to the current question (opt-in, analytics-consent.ts) in a build whose analytics mode is on. The
// vendor SDK is created lazily, on the first allowed event or the moment the user says yes, never at
// launch: some SDKs contact their servers as soon as they are constructed, opted out or not. A "no"
// (or forget) resets the SDK's identity and opts it out, or, when no SDK was created in this session,
// deletes what an earlier session's SDK left on the device (clearSdkStorage); no event is queued for
// later. Pure: no React Native or vendor import, so check-analytics-behaviour runs this file as it is.
import {
  ANALYTICS_CONSENT_VERSION,
  consentStateOf,
  encodeConsentRecord,
  parseConsentRecord,
} from './analytics-consent';
import { sanitizeEvent } from './analytics-sanitize';

import type { AnalyticsConsentStorePort } from './analytics-consent-store-port';
import type {
  AnalyticsConsentChoice,
  AnalyticsConsentState,
  AnalyticsPort,
  AnalyticsProps,
  AnalyticsSdk,
} from './analytics-port';
import type { AnalyticsMode } from '@/config/analytics-config';
import type { TrackingConsent } from '@/services/consent/consent-port';

/** What the adapter is told when it is created. */
export type AnalyticsSdkSetup = {
  /** True only when Apple's ATT answer is 'authorized' (tracking profile); false otherwise. */
  readonly isTrackingAllowed: boolean;
};

/** What the gate needs. The composition root writes the adapter call inside `createSdk`. */
export type CreateAnalyticsOptions = {
  /** The build's analytics mode (readAnalyticsExtra); 'off' never creates the SDK. */
  readonly mode: AnalyticsMode;
  /** The saved consent record. */
  readonly store: AnalyticsConsentStorePort;
  /** Creates the vendor adapter; called at most once, only after consent. */
  readonly createSdk: (setup: AnalyticsSdkSetup) => AnalyticsSdk;
  /**
   * Deletes the vendor's persisted state (ids, unsent queue) without constructing its client. A no
   * or forget() calls it when no SDK runs in this session: after a consent-version bump, or in a
   * session where analytics never started, an earlier session's ids and queue are still on the
   * device and the next yes would send under them. The PostHog adapter exports clearPosthogStorage.
   */
  readonly clearSdkStorage?: () => void;
  /** Epoch milliseconds for the consent record (the ClockPort's nowMs). */
  readonly nowMs: () => number;
  /** The error log: analytics failures are recorded, never shown. */
  readonly onError: (error: unknown) => void;
  /**
   * Tracking profile only (contracts/analytics.json `tracking: true`): Apple's ATT prompt through the
   * canonical ConsentPort's tracking half. Absent in the default profile: analytics never tracks.
   */
  readonly tracking?: TrackingConsent;
  /** Override for tests; the app uses ANALYTICS_CONSENT_VERSION. */
  readonly consentVersion?: number;
};

/** Events held while the SDK starts (the ATT answer, optIn); more are dropped, never stored. */
export const MAX_PENDING_EVENTS = 100;

type CheckedEvent = { readonly name: string; readonly props: AnalyticsProps };

type StoreResult = { readonly ok: boolean; readonly error?: { readonly kind: string } };

type ConsentCell = {
  readonly current: () => AnalyticsConsentState;
  readonly save: (choice: AnalyticsConsentChoice) => void;
  readonly clear: () => void;
};

/**
 * The saved answer, read synchronously once on first use, then kept. First use may be the usage-data
 * prompt's first render (one kv-store getItemSync, cheap); never while the composition root runs.
 */
function createConsentCell(options: CreateAnalyticsOptions): ConsentCell {
  const { store, onError } = options;
  const version = options.consentVersion ?? ANALYTICS_CONSENT_VERSION;
  let state: AnalyticsConsentState | null = null;
  const report = (result: StoreResult): void => {
    if (!result.ok) onError(new Error(result.error?.kind));
  };
  return {
    current: () => {
      if (state !== null) return state;
      const read = store.read();
      report(read);
      state = consentStateOf(read.ok ? parseConsentRecord(read.value) : null, version);
      return state;
    },
    save: (choice) => {
      report(store.write(encodeConsentRecord({ choice, version, decidedAtMs: options.nowMs() })));
      state = choice;
    },
    clear: () => {
      report(store.clear());
      state = 'unknown';
    },
  };
}

function captureAll(
  sdk: AnalyticsSdk,
  events: readonly CheckedEvent[],
  onError: (error: unknown) => void,
): void {
  for (const event of events) {
    try {
      sdk.capture(event.name, event.props);
    } catch (error) {
      onError(error);
    }
  }
}

async function openSdk(options: CreateAnalyticsOptions): Promise<AnalyticsSdk> {
  const { tracking } = options;
  const isTrackingAllowed =
    tracking !== undefined && (await tracking.requestTracking()) === 'authorized';
  return options.createSdk({ isTrackingAllowed });
}

type SdkRunner = {
  readonly send: (event: CheckedEvent) => void;
  readonly resume: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly flush: () => Promise<void>;
};

// PostHog-style SDKs clear a saved opt-out in reset(), so a stop is reset (new ids, unsent queue
// dropped: the adapter's job), then optOut (stop, persisted). With no SDK in this session the
// client is never constructed for a stop: its stored state is deleted instead.
async function stopSdk(
  running: AnalyticsSdk | null,
  options: CreateAnalyticsOptions,
): Promise<void> {
  if (running === null) {
    options.clearSdkStorage?.();
    return;
  }
  running.reset();
  await running.optOut();
}

/** The lazily created SDK: started once, events held while it starts, stopped on a no. */
function createSdkRunner(options: CreateAnalyticsOptions, isAllowed: () => boolean): SdkRunner {
  const { onError } = options;
  const pending: CheckedEvent[] = [];
  let sdk: AnalyticsSdk | null = null;
  let starting: Promise<AnalyticsSdk | null> | null = null;
  let hasFailed = false;
  const start = async (): Promise<AnalyticsSdk | null> => {
    try {
      sdk = await openSdk(options);
      if (isAllowed()) await sdk.optIn(); // else the user said no while it was starting
      const queued = pending.splice(0);
      if (isAllowed()) captureAll(sdk, queued, onError);
      return sdk;
    } catch (error) {
      onError(error);
      hasFailed = true; // one failed start ends analytics for this session, silently
      pending.splice(0);
      return null;
    }
  };
  const ready = (): Promise<AnalyticsSdk | null> => (starting ??= start());
  return {
    send: (event) => {
      if (hasFailed) return;
      if (sdk !== null && pending.length === 0) captureAll(sdk, [event], onError);
      else if (pending.length < MAX_PENDING_EVENTS) pending.push(event);
      ready().catch(onError);
    },
    resume: async () => {
      await (sdk === null ? ready() : sdk.optIn()); // optIn: a yes after a no in this session
    },
    stop: async () => {
      pending.splice(0);
      await stopSdk(sdk ?? (starting === null ? null : await starting), options);
    },
    flush: async () => {
      await sdk?.flush();
    },
  };
}

/** Runs a port call that must never reject: a failure goes to the error log. */
async function quietly(
  task: () => Promise<void>,
  onError: (error: unknown) => void,
): Promise<void> {
  try {
    await task();
  } catch (error) {
    onError(error);
  }
}

/** The app's AnalyticsPort: consent-gated, mode-gated, catalog-checked, never throwing. */
export function createAnalytics(options: CreateAnalyticsOptions): AnalyticsPort {
  const { onError } = options;
  const consent = createConsentCell(options);
  const isAllowed = (): boolean => options.mode !== 'off' && consent.current() === 'granted';
  const runner = createSdkRunner(options, isAllowed);
  return {
    track: (event) => {
      if (!isAllowed()) return;
      const checked = sanitizeEvent(event);
      if (checked.ok) runner.send(checked);
      else onError(new Error(checked.reason));
    },
    consent: () => consent.current(),
    setConsent: (choice) => {
      consent.save(choice);
      if (choice === 'denied') quietly(runner.stop, onError).catch(onError);
      else if (isAllowed()) quietly(runner.resume, onError).catch(onError);
    },
    forget: () => {
      consent.clear();
      return quietly(runner.stop, onError);
    },
    flush: () => (isAllowed() ? quietly(runner.flush, onError) : Promise.resolve()),
  };
}
