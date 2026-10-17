// src/data/open-device-settings.ts
// device-only: covered by the app launch on a device (it only composes the tested settings store with the key-value adapter)
// Part of the composition root: creates the settings store over the device's key-value store, once,
// from the root layout's first-render initializer (never at import time: a reload re-runs modules).
import { createKvSettingsStorageAdapter } from '@/services/settings-storage/kv-settings-storage-adapter';
import { createSettingsStore } from '@/stores/settings/settings-store';

import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { SettingsStore } from '@/stores/settings/settings-store';

export function openDeviceSettings(errorLog: Pick<ErrorLogPort, 'record'>): SettingsStore {
  return createSettingsStore({ storage: createKvSettingsStorageAdapter(errorLog), errorLog });
}
