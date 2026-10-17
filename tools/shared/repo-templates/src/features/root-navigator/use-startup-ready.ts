// src/features/root-navigator/use-startup-ready.ts
// Reads the startup gate and releases the native splash once the gate is ready and React has
// committed the tree that is about to be shown. The release runs in an effect, after the commit, so
// the frame under the splash is the real first screen; never during render (React may render without
// committing) and never at module scope (too early: nothing is on screen yet).
import { useEffect, useSyncExternalStore } from 'react';

import type { StartupGate } from './startup-gate';

/**
 * True once every blocking startup task finished, failed or ran out of time. `releaseSplash` is
 * expo-splash-screen's `hide` in the app (safe to call twice) and a jest.fn() in tests.
 */
export function useStartupReady(gate: StartupGate, releaseSplash: () => void): boolean {
  // The gate is plain data, so the static web render and the device read the same snapshot.
  const isReady = useSyncExternalStore(gate.subscribe, gate.isReady, gate.isReady);
  useEffect(() => {
    if (isReady) releaseSplash();
  }, [isReady, releaseSplash]);
  return isReady;
}
