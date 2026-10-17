// src/services/connectivity/connectivity-port.ts
// Owned by the networking-and-server-state skill (one canonical copy; the ads and purchase skills
// ship the same bytes). The app's one answer to "is the device on a network right now?".

/**
 * How far the OS says the network reaches. `reachable`: connected, and the OS validated internet
 * access (or does not check, as on iOS). `unvalidated`: connected, but Android has not validated
 * the network (a captive portal, a firewall that blocks the probe, a VPN reporting no bandwidth);
 * requests often still work. `none`: no network at all.
 */
export type Reachability = 'reachable' | 'unvalidated' | 'none';

/**
 * The device's connection, as the OS reports it. One adapter for the whole app
 * (expo-network-connectivity-adapter.ts), created once by the composition root; TanStack Query's
 * onlineManager, ads, purchases and offline banners all read this port, so a simulated offline
 * switch in a test build reaches every one of them. Fake: fake-connectivity.ts.
 */
export type ConnectivityPort = {
  /**
   * True when the device is on any network (reachability is not `none`). This is what pauses and
   * resumes TanStack Query: an unvalidated network still counts, because pausing there would keep
   * every request waiting for good while it might succeed. False until the first report arrives.
   */
  readonly isOnline: () => boolean;
  /** Calls `listener` when `isOnline` changes (never with an unchanged value); returns the unsubscribe. */
  readonly subscribe: (listener: (isOnline: boolean) => void) => () => void;
  /** The last reported reachability: a hint for banners, ads and purchases. `none` until the first report. */
  readonly reachability: () => Reachability;
  /** Calls `listener` when the reachability changes (never with an unchanged value); returns the unsubscribe. */
  readonly subscribeReachability: (listener: (reachability: Reachability) => void) => () => void;
};
