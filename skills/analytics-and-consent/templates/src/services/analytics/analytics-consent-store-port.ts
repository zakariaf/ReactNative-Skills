// src/services/analytics/analytics-consent-store-port.ts
// Where the analytics consent record lives between launches. Adapter: kv-analytics-consent-adapter.ts
// (expo-sqlite/kv-store). Fake: createMemoryAnalyticsConsentStore in fake-analytics.ts.
import type { Result } from '@/core/result';

export type AnalyticsConsentReadFailure = { readonly kind: 'analytics-consent-unreadable' };
export type AnalyticsConsentWriteFailure = { readonly kind: 'analytics-consent-not-saved' };

/**
 * Where the consent record lives between launches (kv-analytics-consent-adapter.ts on
 * expo-sqlite/kv-store). Synchronous, so the first event of a launch already knows the answer.
 * Never throws: failures are values.
 */
export type AnalyticsConsentStorePort = {
  /** The saved record text, or null before the first answer. */
  readonly read: () => Result<string | null, AnalyticsConsentReadFailure>;
  /** Replaces the saved record text. */
  readonly write: (text: string) => Result<void, AnalyticsConsentWriteFailure>;
  /** Deletes the saved record (forget). */
  readonly clear: () => Result<void, AnalyticsConsentWriteFailure>;
};
