// src/services/connectivity/expo-network-connectivity-adapter.ts
// The only importer of expo-network. iOS: NWPathMonitor (no HTTP probe; reachability equals
// isConnected). Android: the default network; isInternetReachable is false until the OS validates
// it (NET_CAPABILITY_VALIDATED) and for a VPN reporting zero bandwidth, which some working networks
// never pass, so "online" here follows isConnected alone and reachability is a separate hint.
// One native listener for the app's whole life, fanned out in JS: expo-network 57 keeps one
// NWPathMonitor per module and cancels it when its last JS listener goes, and a cancelled monitor
// never starts again.
import { addNetworkStateListener, getNetworkStateAsync } from 'expo-network';

import { createReachabilityHub } from './reachability-hub';

import type { ConnectivityPort, Reachability } from './connectivity-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { NetworkState } from 'expo-network';

export type ExpoNetworkConnectivityOptions = {
  /** Records a failed first read (unexpected: the state then counts as offline until a change). */
  readonly errorLog: ErrorLogPort;
};

/** No network, a network the OS has not validated, or a validated (or unprobed) one. */
function reachabilityOf(state: NetworkState): Reachability {
  if (state.isConnected !== true) return 'none';
  return state.isInternetReachable === false ? 'unvalidated' : 'reachable';
}

/** Creates the app's ConnectivityPort. Call it once, from the composition root. */
export function createExpoNetworkConnectivityAdapter(
  options: ExpoNetworkConnectivityOptions,
): ConnectivityPort {
  const hub = createReachabilityHub('none');
  // The first read can answer after a listener event; the event is newer, so the read is dropped.
  let hasHeardChange = false;
  // app-lifetime: one native listener for the app's life; expo-network cannot restart its monitor
  addNetworkStateListener((state) => {
    hasHeardChange = true;
    hub.report(reachabilityOf(state));
  });
  getNetworkStateAsync()
    .then((state) => {
      if (!hasHeardChange) hub.report(reachabilityOf(state));
    })
    .catch((error: unknown) => {
      options.errorLog.record('network', error);
    });
  return hub.port;
}
