// src/services/analytics/analytics-context.tsx
// How features reach the app's one AnalyticsPort: the analytics root kit (analytics-root-kit.tsx)
// wraps the root Stack in this provider, so a model hook calls useAnalytics().track(...) in a
// handler. Context carries the port (a dependency), never state. Tests wrap the code under test in
// <AnalyticsProvider analytics={createFakeAnalytics()}>.
import { createContext, use } from 'react';

import type { AnalyticsPort } from './analytics-port';
import type { JSX, ReactNode } from 'react';

const AnalyticsContext = createContext<AnalyticsPort | null>(null);

export type AnalyticsProviderProps = {
  readonly analytics: AnalyticsPort;
  readonly children: ReactNode;
};

/** Hands the AnalyticsPort down (the analytics root kit mounts it around the root Stack). */
export function AnalyticsProvider({ analytics, children }: AnalyticsProviderProps): JSX.Element {
  return <AnalyticsContext value={analytics}>{children}</AnalyticsContext>;
}

/** The app's AnalyticsPort. A missing provider is a programmer error, so it throws. */
export function useAnalytics(): AnalyticsPort {
  const analytics = use(AnalyticsContext);
  if (analytics === null) {
    throw new Error(
      'useAnalytics() needs the analytics root kit (createAnalyticsKit in createRootKits) above it',
    );
  }
  return analytics;
}
