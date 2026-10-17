// src/services/analytics/analytics-root-kit.tsx
// Analytics as a root kit (app-startup-and-bootstrap's slots): one entry in
// src/services/create-root-kits.ts plugs it into startup, and no root file changes. The registry
// creates the one AnalyticsPort with createAnalytics (the consent gate: nothing leaves the device
// before a yes, and the vendor SDK exists only after it); the kit hands it to the slots: provide
// (AnalyticsProvider around the root Stack, so features call useAnalytics().track), effects (one
// screen_view per route pattern, beside the Stack) and flushers (queued events sent on the way to
// the background, before the WAL checkpoint).
import { useScreenViews } from '@/hooks/use-screen-views';

import { AnalyticsProvider } from './analytics-context';

import type { AnalyticsPort } from './analytics-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { KitFlusher, RootKit } from '@/services/root-kits/root-kit';

export type AnalyticsKitInput = {
  /** The app's one AnalyticsPort, from createAnalytics in the registry. */
  readonly analytics: AnalyticsPort;
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
};

/**
 * The analytics flusher: starts the flush and returns at once, as the background flush expects (the
 * JS thread may be suspended right after). flush() never rejects; the catch keeps it handled.
 */
export function analyticsFlusher(
  analytics: Pick<AnalyticsPort, 'flush'>,
  errorLog: Pick<ErrorLogPort, 'record'>,
): KitFlusher {
  return {
    name: 'analytics',
    flush: () => {
      analytics.flush().catch((error: unknown) => {
        errorLog.record('service', error);
      });
    },
  };
}

type ScreenViewsProps = { readonly analytics: Pick<AnalyticsPort, 'track'> };

/** Renders nothing: one screen_view per screen, by route pattern; the gate drops it before a yes. */
function ScreenViews({ analytics }: ScreenViewsProps): null {
  useScreenViews((screen) => {
    analytics.track({ name: 'screen_view', props: { screen } });
  });
  return null;
}

/** The analytics kit: register it once in createRootKits. */
export function createAnalyticsKit({ analytics, errorLog }: AnalyticsKitInput): RootKit {
  return {
    name: 'analytics',
    flushers: [analyticsFlusher(analytics, errorLog)],
    provide: (children) => <AnalyticsProvider analytics={analytics}>{children}</AnalyticsProvider>,
    effects: <ScreenViews analytics={analytics} />,
  };
}
