// src/services/analytics/analytics-consent.ts
// The saved consent record and its codec. A record answers one version of the question: when the
// app starts collecting something new (an event family, a data type, a vendor), raise
// ANALYTICS_CONSENT_VERSION and every earlier answer reads as 'unknown', so the user is asked again
// before the new collection starts. Pure: the gate passes the time in.
import { attempt } from '@/core/result';

import type { AnalyticsConsentChoice, AnalyticsConsentState } from './analytics-port';

/**
 * The version of the question the prompt asks. Raise it (never lower it) whenever
 * contracts/analytics.json `collects` or the vendor changes.
 */
export const ANALYTICS_CONSENT_VERSION = 1;

/** What is saved: the answer, the question version it answers, and when it was given. */
export type AnalyticsConsentRecord = {
  readonly choice: AnalyticsConsentChoice;
  readonly version: number;
  readonly decidedAtMs: number;
};

function isChoice(value: unknown): value is AnalyticsConsentChoice {
  return value === 'granted' || value === 'denied';
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Reads a saved record; anything malformed is null (the user is asked again). */
export function parseConsentRecord(text: string | null): AnalyticsConsentRecord | null {
  if (text === null) return null;
  const parsed = attempt(
    () => JSON.parse(text) as unknown,
    () => ({ kind: 'analytics-consent-malformed' }) as const,
  );
  if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null) return null;
  const { choice, version, decidedAtMs } = parsed.value as Record<string, unknown>;
  if (!isChoice(choice) || !isWholeNumber(version) || !isWholeNumber(decidedAtMs)) return null;
  return { choice, version, decidedAtMs };
}

/** The text the store saves. */
export function encodeConsentRecord(record: AnalyticsConsentRecord): string {
  return JSON.stringify(record);
}

/** The state a record means today: an answer to an older question is no answer. */
export function consentStateOf(
  record: AnalyticsConsentRecord | null,
  currentVersion: number = ANALYTICS_CONSENT_VERSION,
): AnalyticsConsentState {
  if (record === null || record.version < currentVersion) return 'unknown';
  return record.choice;
}
