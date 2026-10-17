// src/services/create-root-kits.ts
// device-only: covered by the app launch on a device (it only composes the kits, each tested beside its own files)
// The app's one registry of optional root kits: the only file a kit edits to join startup. AppRoot's
// startApp calls prepareRootKits first (the ports every reader uses: a test build swaps in its
// simulated clock and network there), then createRootKits once per JS run, after the data layer, the
// settings and the stores, and the root skeleton hands each kit's parts to its slots
// (src/services/root-kits/root-kit.ts): error forwarding, blocking startup tasks, flushers, the motion
// config, the test-build route group, providers and effects around the root Stack. A kit's skill
// shows its line (crash reporting, analytics, local and push notifications, the test build's debug
// kit); the root files stay unchanged. A test-only kit is reached only through the test-only gate
// (TEST_ONLY is null in a production build, so none ships). Part of the composition root: it may
// create adapters (no I/O), so it runs only from startApp, never at import time.
import type { AppData } from '@/data/app-data-context';
import type { Language } from '@/i18n/languages';
import type { RootKit } from '@/services/root-kits/root-kit';
import type { Services } from '@/services/services-context';

/**
 * What prepareRootKits hands startApp: the ports every reader uses from then on, plus what the app's
 * kits keep from that step (a test build's hooks: debug-menu-and-test-hooks). Nothing else yet.
 */
export type PreparedKits = { readonly services: Services };

/**
 * Startup step E1, before the data layer opens and before anything reads a port: the device services,
 * unchanged until a test build's kit wraps them (examples in debug-menu-and-test-hooks). Adapters only,
 * no I/O beyond a test-only key-value read.
 */
export function prepareRootKits(services: Services): PreparedKits {
  return { services };
}

/**
 * What startApp hands the registry: the prepared ports, the open data layer, this run's language and
 * the prepared kits. An app that opens settings or stores in startApp adds them here and to the call.
 */
export type RootKitsInput = {
  readonly services: Services;
  readonly data: AppData;
  readonly language: Language;
  readonly prepared: PreparedKits;
};

/** Every optional kit, in the order their providers nest (the first outermost). None yet. */
export function createRootKits(_input: RootKitsInput): readonly RootKit[] {
  return [];
}
