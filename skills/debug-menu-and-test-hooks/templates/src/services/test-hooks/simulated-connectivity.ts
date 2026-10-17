// src/services/test-hooks/simulated-connectivity.ts
// The test build's "simulate offline" switch: a full ConnectivityPort on the canonical reachability
// hub. While simulating offline it reports `none`; otherwise it forwards the real adapter's
// reachability. isOnline stays derived from reachability and unchanged reports are dropped (the hub
// does both), so TanStack Query's onlineManager, offline banners, ads and purchases all follow the
// switch exactly as they follow the real network.
import { createReachabilityHub } from '@/services/connectivity/reachability-hub';

import type { ConnectivityPort } from '@/services/connectivity/connectivity-port';

export type SimulatedConnectivity = {
  /** The port the composition root hands to every reader instead of the real one. */
  readonly port: ConnectivityPort;
  /** true: every reader hears `none`; false: the real reachability again. */
  readonly setOffline: (isOffline: boolean) => void;
  /** Stops following the real adapter. */
  readonly stop: () => void;
};

export function createSimulatedConnectivity(
  real: ConnectivityPort,
  isInitiallyOffline: boolean,
): SimulatedConnectivity {
  let isOffline = isInitiallyOffline;
  const hub = createReachabilityHub(isOffline ? 'none' : real.reachability());
  const stop = real.subscribeReachability((next) => {
    if (!isOffline) hub.report(next);
  });
  return {
    port: hub.port,
    setOffline: (isNowOffline) => {
      isOffline = isNowOffline;
      hub.report(isNowOffline ? 'none' : real.reachability());
    },
    stop,
  };
}
