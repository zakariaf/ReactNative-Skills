// src/test-only-entry.ts
// The manifest of test-only code: re-exports and the sentinel, nothing else. Only the gate
// (src/test-only.ts, same folder) loads it; any other import would ship it in every build. Every
// module it re-exports lives in a test-only folder (contracts/architecture.json testOnlyFolders) or
// is a test-only adapter in src/services/, so the gate's fold removes all of it from production.

/**
 * A string that exists nowhere else in the app (<APP>_TEST_BUILD_ONLY: put the app's name first).
 * Development and preview bundles contain it, production bundles must not: the bundle and build
 * checks find every exported *SENTINEL* string by its name.
 */
export const TEST_BUILD_SENTINEL = 'TASKS_TEST_BUILD_ONLY';

export { createTestHooks } from '@/services/test-hooks/create-test-hooks';
export { createDebugKit } from '@/features/debug/debug-root-kit';
export { DebugMenuRoot } from '@/features/debug/debug-menu-root';
export { DebugSetupRoot } from '@/features/debug/debug-setup-root';
export { createKvDebugStorageAdapter } from '@/services/debug-storage/kv-debug-storage-adapter';
export { installNetworkGuard } from '@/services/test-hooks/network-guard';
export { createParityKit } from '@/features/parity/parity-root-kit';
export { ParityLaunchScreen } from '@/features/debug/parity-launch-screen';
