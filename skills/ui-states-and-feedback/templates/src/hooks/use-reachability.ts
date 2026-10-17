// src/hooks/use-reachability.ts
import { useSyncExternalStore } from 'react';

import type { ConnectivityPort, Reachability } from '@/services/connectivity/connectivity-port';

/**
 * The device's reachability for an offline banner, read from the app's one ConnectivityPort
 * (networking-and-server-state owns it), never from expo-network in a screen. A model hook passes
 * useServices().connectivity; the subscription ends with the component.
 */
export function useReachability(connectivity: ConnectivityPort): Reachability {
  return useSyncExternalStore(
    connectivity.subscribeReachability,
    connectivity.reachability,
    connectivity.reachability,
  );
}
