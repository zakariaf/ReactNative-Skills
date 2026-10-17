// src/services/analytics/fake-analytics.ts
// Test doubles: a recording AnalyticsPort for feature tests (createFakeAnalytics), a scripted vendor
// SDK for the gate's own tests (createFakeAnalyticsSdk) and an in-memory consent store. No test ever
// creates the real adapter: tests and E2E builds never send analytics.
import { ok } from '@/core/result';

import type { AnalyticsConsentStorePort } from './analytics-consent-store-port';
import type { AnalyticsEvent } from './analytics-events';
import type {
  AnalyticsConsentChoice,
  AnalyticsConsentState,
  AnalyticsPort,
  AnalyticsProps,
  AnalyticsSdk,
} from './analytics-port';

/** The recording port and what it saw. */
export type FakeAnalytics = AnalyticsPort & {
  /** Every event passed to track(), in order (recorded whatever the consent). */
  readonly events: () => readonly AnalyticsEvent[];
};

/** An AnalyticsPort that records events; consent starts at `consent` (default 'unknown'). */
export function createFakeAnalytics(consent: AnalyticsConsentState = 'unknown'): FakeAnalytics {
  const events: AnalyticsEvent[] = [];
  let state = consent;
  return {
    track: (event) => {
      events.push(event);
    },
    consent: () => state,
    setConsent: (choice: AnalyticsConsentChoice) => {
      state = choice;
    },
    forget: () => {
      state = 'unknown';
      return Promise.resolve();
    },
    flush: () => Promise.resolve(),
    events: () => [...events],
  };
}

/** The scripted SDK and its call log ('optIn', 'capture task_created', 'reset', ...). */
export type FakeAnalyticsSdk = AnalyticsSdk & {
  readonly calls: () => readonly string[];
  /** The captured events with their properties, in order. */
  readonly captured: () => readonly { readonly name: string; readonly props: AnalyticsProps }[];
};

/** A vendor SDK stand-in; `failOn` makes that method throw (to prove the gate never does). */
export function createFakeAnalyticsSdk(failOn?: keyof AnalyticsSdk): FakeAnalyticsSdk {
  const calls: string[] = [];
  const captured: { name: string; props: AnalyticsProps }[] = [];
  const log = (name: keyof AnalyticsSdk, detail = ''): void => {
    calls.push(detail === '' ? name : `${name} ${detail}`);
    if (failOn === name) throw new Error(`${name} failed`);
  };
  return {
    optIn: () => {
      log('optIn');
      return Promise.resolve();
    },
    capture: (name, props) => {
      log('capture', name);
      captured.push({ name, props });
    },
    flush: () => {
      log('flush');
      return Promise.resolve();
    },
    optOut: () => {
      log('optOut');
      return Promise.resolve();
    },
    reset: () => {
      log('reset');
    },
    calls: () => [...calls],
    captured: () => [...captured],
  };
}

/** The consent store in memory, starting with `text` (a saved record) or nothing. */
export function createMemoryAnalyticsConsentStore(
  text: string | null = null,
): AnalyticsConsentStorePort & { readonly saved: () => string | null } {
  let saved = text;
  return {
    read: () => ok(saved),
    write: (next) => {
      saved = next;
      return ok(undefined);
    },
    clear: () => {
      saved = null;
      return ok(undefined);
    },
    saved: () => saved,
  };
}
