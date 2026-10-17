// src/services/debug-storage/kv-debug-storage-adapter.ts
// The DebugStoragePort on expo-sqlite/kv-store: its own small database, apart from the app's data and
// preferences, with synchronous calls so the switches are back before the first render. Only the
// test-only entry exports it, so production bundles never contain it.
import Storage from 'expo-sqlite/kv-store';

import { attempt } from '@/core/result';

import type { DebugStoragePort } from '@/services/debug-storage/debug-storage-port';

/** The kv-store key; namespaced so it never meets the app's own preferences. */
export const DEBUG_OVERRIDES_KEY = 'debug.overrides';

export function createKvDebugStorageAdapter(): DebugStoragePort {
  return {
    read: () =>
      attempt(
        () => Storage.getItemSync(DEBUG_OVERRIDES_KEY),
        () => ({ kind: 'debug-storage-unreadable' }) as const,
      ),
    write: (text) =>
      attempt(
        () => {
          if (text === null) Storage.removeItemSync(DEBUG_OVERRIDES_KEY);
          else Storage.setItemSync(DEBUG_OVERRIDES_KEY, text);
        },
        () => ({ kind: 'debug-storage-not-saved' }) as const,
      ),
  };
}
