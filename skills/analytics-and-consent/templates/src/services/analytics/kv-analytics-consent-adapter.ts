// src/services/analytics/kv-analytics-consent-adapter.ts
// The consent record on expo-sqlite/kv-store: a small key-value database apart from the app's data,
// readable synchronously, so the first event of a launch already knows the answer. The record is the
// user's own choice: it stays on the device and is never sent anywhere.
import Storage from 'expo-sqlite/kv-store';

import { attempt } from '@/core/result';

import type { AnalyticsConsentStorePort } from './analytics-consent-store-port';

/** The kv-store key; namespaced so it never collides with the app's own preferences. */
export const ANALYTICS_CONSENT_KEY = 'analytics.consent';

const UNREADABLE = { kind: 'analytics-consent-unreadable' } as const;
const NOT_SAVED = { kind: 'analytics-consent-not-saved' } as const;

/** The AnalyticsConsentStorePort on expo-sqlite/kv-store (never throws). */
export function createKvAnalyticsConsentAdapter(): AnalyticsConsentStorePort {
  return {
    read: () =>
      attempt(
        () => Storage.getItemSync(ANALYTICS_CONSENT_KEY),
        () => UNREADABLE,
      ),
    write: (text) =>
      attempt(
        () => {
          Storage.setItemSync(ANALYTICS_CONSENT_KEY, text);
        },
        () => NOT_SAVED,
      ),
    clear: () =>
      attempt(
        () => {
          Storage.removeItemSync(ANALYTICS_CONSENT_KEY);
        },
        () => NOT_SAVED,
      ),
  };
}
