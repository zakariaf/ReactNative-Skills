// src/services/settings-storage/kv-settings-storage-adapter.ts
// device-only: covered by the restart check on a device (change a setting, kill the app, relaunch: references/settings-model.md)
// The settings text in expo-sqlite's key-value store: its own small SQLite database, apart from the
// app database, so no table migration or data reset ever touches it. Synchronous calls, so the
// store hydrates before the first paint. Every unexpected failure is recorded raw, then converted.
import { Storage } from 'expo-sqlite/kv-store';

import { attempt } from '@/core/result';

import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { SettingsStoragePort } from '@/services/settings-storage/settings-storage-port';

/** The one key the settings live under. Renaming it orphans every saved setting. */
export const SETTINGS_STORAGE_KEY = 'settings';

export function createKvSettingsStorageAdapter(
  errorLog: Pick<ErrorLogPort, 'record'>,
): SettingsStoragePort {
  return {
    read: () =>
      attempt(
        () => Storage.getItemSync(SETTINGS_STORAGE_KEY),
        (thrown) => {
          errorLog.record('storage', thrown);
          return { kind: 'settings-unreadable' } as const;
        },
      ),
    write: (text) =>
      attempt(
        () => {
          Storage.setItemSync(SETTINGS_STORAGE_KEY, text);
        },
        (thrown) => {
          errorLog.record('storage', thrown);
          return { kind: 'settings-not-saved' } as const;
        },
      ),
  };
}
