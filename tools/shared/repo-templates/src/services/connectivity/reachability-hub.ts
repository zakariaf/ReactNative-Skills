// src/services/connectivity/reachability-hub.ts
// The fan-out behind every ConnectivityPort (the expo-network adapter and the fake): one current
// reachability, two kinds of listener, each told only when its own value changes.
import type { ConnectivityPort, Reachability } from './connectivity-port';

export type ReachabilityHub = {
  /** The port consumers read. */
  readonly port: ConnectivityPort;
  /** Stores a new reachability and tells the listeners whose value changed. */
  readonly report: (next: Reachability) => void;
  /** How many listeners of either kind are subscribed right now. */
  readonly listenerCount: () => number;
};

/** Creates a hub starting at `initial` (adapters start at `none`: unknown counts as offline). */
export function createReachabilityHub(initial: Reachability): ReachabilityHub {
  let reachability = initial;
  const onlineListeners = new Set<(isOnline: boolean) => void>();
  const reachabilityListeners = new Set<(reachability: Reachability) => void>();
  const report = (next: Reachability): void => {
    if (next === reachability) return;
    const wasOnline = reachability !== 'none';
    reachability = next;
    for (const listener of reachabilityListeners) listener(next);
    const isNowOnline = next !== 'none';
    if (isNowOnline === wasOnline) return;
    for (const listener of onlineListeners) listener(isNowOnline);
  };
  const port: ConnectivityPort = {
    isOnline: () => reachability !== 'none',
    subscribe: (listener) => {
      onlineListeners.add(listener);
      return () => {
        onlineListeners.delete(listener);
      };
    },
    reachability: () => reachability,
    subscribeReachability: (listener) => {
      reachabilityListeners.add(listener);
      return () => {
        reachabilityListeners.delete(listener);
      };
    },
  };
  return {
    port,
    report,
    listenerCount: () => onlineListeners.size + reachabilityListeners.size,
  };
}
