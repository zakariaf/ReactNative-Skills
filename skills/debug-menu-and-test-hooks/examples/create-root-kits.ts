// src/services/create-root-kits.ts (example: a shape, not a template)
// The app's one registry of root kits (app-startup-and-bootstrap's template) with the test build's
// lines, marked `// new`. The canonical root skeleton stays unchanged: AppRoot's startApp calls
// prepareRootKits first, before the data layer opens and before anything reads a port, and later
// createRootKits, and hands the kits to the root slots. In a test build prepareRootKits wraps the
// device services once (the simulated clock and, once the services hold one, the simulated
// connectivity) and every reader gets those services; the debug kit then puts TestHooksRoot in
// MotionConfig's place (the motion slot) and opens the (debug) route group that AppStack keeps
// behind Stack.Protected (opensDebugRoutes). In production TEST_ONLY is null: the device services go
// on unchanged, no test-only kit exists, the group stays closed, and none of the code ships.
import { TEST_ONLY } from '@/test-only'; // new

import type { AppData } from '@/data/app-data-context';
import type { Language } from '@/i18n/languages';
import type { RootKit } from '@/services/root-kits/root-kit';
import type { Services } from '@/services/services-context';
import type { TestOnlyApi } from '@/test-only'; // new

/** new: a test build's hooks (the switches store and the swapped ports). */
type TestHooks = ReturnType<TestOnlyApi['createTestHooks']>;

/** What prepareRootKits hands startApp: the ports every reader uses, and the hooks (new). */
export type PreparedKits = { readonly services: Services; readonly testHooks: TestHooks | null };

/** Startup step E1: the device services, wrapped once in a test build (new). */
export function prepareRootKits(device: Services): PreparedKits {
  // Pass a DebugSettingsTarget (examples/settings-target.ts) once the app saves a language and a
  // theme; until then lang= and theme= links are refused.
  const testHooks =
    TEST_ONLY?.createTestHooks({
      services: device,
      storage: TEST_ONLY.createKvDebugStorageAdapter(),
      settings: null,
    }) ?? null;
  return { services: testHooks?.services ?? device, testHooks }; // never the device services beside the hooks'
}

export type RootKitsInput = {
  readonly services: Services;
  readonly data: AppData;
  readonly language: Language;
  readonly prepared: PreparedKits;
};

/** new: the test build's debug kit over the hooks prepareRootKits made; none in production. */
function debugKits({ prepared }: RootKitsInput): readonly RootKit[] {
  const createDebugKit = TEST_ONLY?.createDebugKit;
  if (prepared.testHooks === null || createDebugKit === undefined) return [];
  return [createDebugKit(prepared.testHooks)];
}

/** Every optional kit, in the order their providers nest (the first outermost). */
export function createRootKits(input: RootKitsInput): readonly RootKit[] {
  return [...debugKits(input)];
}
