// src/services/create-root-kits.ts
// The analytics lines of app-startup-and-bootstrap's root-kit registry (a shape: the template's other
// lines stay). The registry creates the one AnalyticsPort and registers the analytics root kit, which
// provides it to features (useAnalytics()), sends screen views and flushes on the way to the
// background; no root file changes. Only this file imports the vendor adapter, and only inside
// createSdk, so the SDK is constructed after consent and never in an ANALYTICS_MODE=off build.
// Nothing here reads storage: the gate reads the consent record on first use (the usage-data model or
// the first event), never while the kits are created.
import * as Application from 'expo-application';
import Constants from 'expo-constants';

import { readAnalyticsExtra } from '@/config/analytics-config';
import { createAnalyticsKit } from '@/services/analytics/analytics-root-kit';
import { createAnalytics } from '@/services/analytics/create-analytics';
import { createKvAnalyticsConsentAdapter } from '@/services/analytics/kv-analytics-consent-adapter';
import {
  clearPosthogStorage,
  createPosthogAnalyticsAdapter,
} from '@/services/analytics/posthog-analytics-adapter';

import type { AppData } from '@/data/app-data-context';
import type { Language } from '@/i18n/languages';
import type { AnalyticsPort } from '@/services/analytics/analytics-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { RootKit } from '@/services/root-kits/root-kit';
import type { Services } from '@/services/services-context';

export type RootKitsInput = {
  readonly services: Services;
  readonly data: AppData;
  readonly language: Language;
};

function createAppAnalytics(errorLog: ErrorLogPort, nowMs: () => number): AnalyticsPort {
  const runtime = readAnalyticsExtra(Constants.expoConfig?.extra, Application.applicationId);
  return createAnalytics({
    mode: runtime.mode,
    store: createKvAnalyticsConsentAdapter(),
    nowMs,
    onError: (error) => {
      errorLog.record('service', error);
    },
    createSdk: (setup) => {
      if (runtime.mode === 'off') throw new Error('analytics is off in this build');
      return createPosthogAnalyticsAdapter({
        ...setup,
        apiKey: runtime.apiKey,
        host: runtime.host,
      });
    },
    // A no or forget() with no client in this session deletes an earlier session's ids and queue.
    clearSdkStorage: clearPosthogStorage,
    // Tracking profile only (contracts/analytics.json tracking: true):
    // tracking: createExpoTrackingConsentAdapter({ onError }),
  });
}

/** Every optional kit, in the order their providers nest (the first outermost). */
export function createRootKits({ services, data }: RootKitsInput): readonly RootKit[] {
  const analytics = createAppAnalytics(data.errorLog, services.clock.nowMs);
  return [createAnalyticsKit({ analytics, errorLog: data.errorLog })];
}
