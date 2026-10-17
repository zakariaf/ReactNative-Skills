// src/services/test-hooks/create-test-hooks.ts
// The startup's one test-only call (TEST_ONLY?.createTestHooks in the app registry's prepareRootKits,
// the first step of AppRoot's startApp): creates the debug switches' store (hydrated from the
// test-only key-value store), wraps the real clock and, when the services hold one, the real
// connectivity port, and returns the same services with those two members swapped. startApp hands
// those services, and nothing else, to the data layer and the app, so one switch reaches every reader
// (due dates, TanStack Query's onlineManager through services.connectivity, banners, ads, purchases);
// the debug kit's TestHooksRoot, in the root's motion slot, provides the hooks to the debug screens.
import { createDebugOverridesStore } from '@/stores/debug-overrides/debug-overrides-store';

import { createSimulatedClock } from './simulated-clock';
import { createSimulatedConnectivity } from './simulated-connectivity';

import type { DebugSettingsTarget } from './debug-settings-target';
import type { ConnectivityPort } from '@/services/connectivity/connectivity-port';
import type { DebugStoragePort } from '@/services/debug-storage/debug-storage-port';
import type { Services } from '@/services/services-context';
import type { DebugOverridesStore } from '@/stores/debug-overrides/debug-overrides-store';

/**
 * The app's Services. Once networking-and-server-state adds `connectivity` to them, the hooks swap
 * it for the simulated port; an app without one simply has no "simulate offline" to reach.
 */
export type HookableServices = Services & { readonly connectivity?: ConnectivityPort };

export type TestHooksDeps<TServices extends HookableServices> = {
  /** The device services from createDeviceServices(); the result swaps their clock and connectivity. */
  readonly services: TServices;
  /** The test-only key-value store (TEST_ONLY.createKvDebugStorageAdapter() on a device). */
  readonly storage: DebugStoragePort;
  /** How a debug link changes the language and theme; null refuses lang= and theme=. */
  readonly settings: DebugSettingsTarget | null;
};

export type TestHooks<TServices extends HookableServices = HookableServices> = {
  /** The services to use everywhere: the same ports, with the simulated clock and connectivity. */
  readonly services: TServices;
  readonly overrides: DebugOverridesStore;
  readonly settings: DebugSettingsTarget | null;
  /** Stops following the store and the real adapter (tests; the app keeps them for its lifetime). */
  readonly stop: () => void;
};

export function createTestHooks<TServices extends HookableServices>(
  deps: TestHooksDeps<TServices>,
): TestHooks<TServices> {
  const overrides = createDebugOverridesStore({
    storage: deps.storage,
    errorLog: deps.services.errorLog,
  });
  const clock = createSimulatedClock(
    deps.services.clock,
    () => overrides.getState().overrides.today,
  );
  const realConnectivity = deps.services.connectivity;
  const offline =
    realConnectivity === undefined
      ? null
      : createSimulatedConnectivity(realConnectivity, overrides.getState().overrides.isOffline);
  const unsubscribe = overrides.subscribe((next, previous) => {
    if (next.overrides.isOffline !== previous.overrides.isOffline) {
      offline?.setOffline(next.overrides.isOffline);
    }
  });
  const swapped = offline === null ? { clock } : { clock, connectivity: offline.port };
  return {
    services: { ...deps.services, ...swapped },
    overrides,
    settings: deps.settings,
    stop: () => {
      unsubscribe();
      offline?.stop();
    },
  };
}
