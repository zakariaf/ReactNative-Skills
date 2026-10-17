// src/services/permissions/system-settings-adapter.ts
// The way back from 'blocked': opens this app's own page in the system Settings app (iOS: the app's
// entry with its permission switches; Android: App info, where Permissions lists each one). React
// Native's Linking.openSettings() does both. Nothing here rejects: a failure is recorded, and the
// sheet that offered the button simply closes.
import { Linking } from 'react-native';

import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { PermissionsPort } from '@/services/permissions/permissions-port';

export type SystemSettingsAdapterOptions = {
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
};

/** The openSettings member of the PermissionsPort. */
export function createSystemSettingsAdapter(
  options: SystemSettingsAdapterOptions,
): Pick<PermissionsPort, 'openSettings'> {
  return {
    openSettings: async () => {
      try {
        await Linking.openSettings();
      } catch (error) {
        options.errorLog.record('service', error);
      }
    },
  };
}
