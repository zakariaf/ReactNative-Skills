// src/services/analytics/posthog-analytics-adapter.ts
// The vendor adapter for PostHog (posthog-react-native 4.79.1, read in its source on 2026-10-14):
// the only file that imports the package. createAnalytics calls it once, after consent, so the
// client is never constructed before the user said yes (the constructor loads PostHog's remote
// config whether or not the client is opted out). Every option below is a privacy decision; the
// comment says why, and check-analytics reads the risky ones.
import Storage from 'expo-sqlite/kv-store';
import { PostHog, PostHogPersistedProperty } from 'posthog-react-native';

import type { AnalyticsSdk } from './analytics-port';
import type { AnalyticsSdkSetup } from './create-analytics';

/** What the adapter needs (readAnalyticsExtra gives the key and host). */
export type PostHogAdapterOptions = AnalyticsSdkSetup & {
  readonly apiKey: string;
  /** The region chosen on purpose (contracts/analytics.json endpoints), never the SDK default. */
  readonly host: string;
};

/**
 * The kv-store keys PostHog keeps its state under (`customStorage` below): the events file holds
 * the anonymous and device ids and the unsent queue (EVENTS_STORAGE_FILE and LOGS_STORAGE_FILE in
 * posthog-react-native 4.79.1 dist/storage.js; re-verify on an upgrade).
 */
const POSTHOG_STORAGE_KEYS = ['.posthog-rn.json', '.posthog-rn-logs.json'] as const;

/**
 * Deletes what an earlier session's client left on the device, without constructing a client (the
 * constructor contacts PostHog). The gate calls it (createAnalytics clearSdkStorage) on a no or
 * forget() when no client runs in this session, so the next yes starts under new ids.
 */
export function clearPosthogStorage(): void {
  for (const key of POSTHOG_STORAGE_KEYS) Storage.removeItemSync(key);
}

/**
 * PostHog behind the AnalyticsSdk seam. PostHog reads no advertising identifier, so
 * isTrackingAllowed changes nothing here; an attribution SDK (tracking profile) uses it to decide
 * whether it may read the IDFA or the advertising ID.
 */
export function createPosthogAnalyticsAdapter(options: PostHogAdapterOptions): AnalyticsSdk {
  const client = new PostHog(options.apiKey, {
    host: options.host,
    // Created opted out; the gate calls optIn() right after, and a reset never opts back in.
    defaultOptIn: false,
    // Anonymous analytics: no person profiles, identify() is a no-op.
    personProfiles: 'never',
    // No IP-derived location (otherwise declare coarse-location in contracts/analytics.json).
    disableGeoip: true,
    // Only catalog events: no automatic lifecycle events, surveys, flags or logs.
    captureAppLifecycleEvents: false,
    disableSurveys: true,
    // No flag requests at all: reset() otherwise reloads flags (a /flags call carrying the anonymous
    // and device ids) on every withdrawal, and preloadFeatureFlags: false does not stop that.
    disableRemoteFeatureFlags: true,
    // Crash reporting is its own port (crash-reporting-and-observability); no second error handler.
    errorTracking: { autocapture: false },
    // Never record the screen: session replay captures what the user typed and saw.
    enableSessionReplay: false,
    // The SDK's own keys live in kv-store (async-storage is not part of this stack).
    customStorage: {
      getItem: (key) => Storage.getItemSync(key),
      setItem: (key, value) => {
        Storage.setItemSync(key, value);
      },
    },
  });
  return {
    optIn: () => client.optIn(),
    capture: (name, props) => {
      client.capture(name, { ...props });
    },
    flush: () => client.flush(),
    optOut: () => client.optOut(),
    reset: () => {
      // [] keeps nothing: the React Native reset() keeps the device id by default, so the stable id
      // would survive a no. (It still keeps PostHog's project config: remote config, replay and
      // survey settings, push registration; none of them identifies the user.)
      client.reset([]);
      // reset() keeps the event queue and a flush ignores the opt-out: drop what was captured
      // before the no. A batch already on the wire cannot be recalled.
      client.setPersistedProperty(PostHogPersistedProperty.Queue, null);
    },
  };
}
