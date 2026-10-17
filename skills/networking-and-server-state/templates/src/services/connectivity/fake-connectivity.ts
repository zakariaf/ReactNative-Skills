// src/services/connectivity/fake-connectivity.ts
// Jest only: a ConnectivityPort whose answer the test sets. (A test build's "simulate offline" switch
// wraps the real adapter instead; debug-menu-and-test-hooks owns it.)
import { createReachabilityHub } from './reachability-hub';

import type { ConnectivityPort, Reachability } from './connectivity-port';

export type FakeConnectivity = ConnectivityPort & {
  /** Reports `reachable` (true) or `none` (false) to every listener; nothing happens when unchanged. */
  readonly setOnline: (isOnline: boolean) => void;
  /** Reports a reachability; `unvalidated` counts as online. Nothing happens when unchanged. */
  readonly setReachability: (reachability: Reachability) => void;
  /** How many listeners of either kind are subscribed right now: proves that a consumer cleaned up. */
  readonly listenerCount: () => number;
};

/** A ConnectivityPort for tests, starting online (`reachable`) or offline (`none`). */
export function createFakeConnectivity(isInitiallyOnline: boolean): FakeConnectivity {
  const hub = createReachabilityHub(isInitiallyOnline ? 'reachable' : 'none');
  return {
    ...hub.port,
    setOnline: (isNowOnline) => {
      hub.report(isNowOnline ? 'reachable' : 'none');
    },
    setReachability: hub.report,
    listenerCount: hub.listenerCount,
  };
}
