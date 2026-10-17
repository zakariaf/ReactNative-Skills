// src/services/install-marker/kv-install-marker-adapter.ts
// The InstallMarkerPort on expo-sqlite/kv-store: a small SQLite key-value file inside the app's
// sandbox, readable synchronously before the first render. Deleting the app deletes it on iOS and
// Android; a device backup restores it together with the rest of the sandbox, while the tokens
// (Keychain items marked THIS_DEVICE_ONLY, Android SecureStore preferences left out of Auto Backup)
// stay behind, so a restored phone starts signed out either way.
import Storage from 'expo-sqlite/kv-store';

import { attempt } from '@/core/result';

import type { InstallMarkerFailure, InstallMarkerPort } from './install-marker-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

/** The kv-store key; namespaced so it never collides with the app's own preferences. */
export const INSTALL_MARKER_KEY = 'auth.install-marker';

export type KvInstallMarkerAdapterDeps = {
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
};

export function createKvInstallMarkerAdapter({
  errorLog,
}: KvInstallMarkerAdapterDeps): InstallMarkerPort {
  const failure = (thrown: unknown): InstallMarkerFailure => {
    errorLog.record('storage', thrown);
    return { kind: 'install-marker-unavailable' };
  };
  return {
    isPresent: () => attempt(() => Storage.getItemSync(INSTALL_MARKER_KEY) !== null, failure),
    write: () =>
      attempt(() => {
        Storage.setItemSync(INSTALL_MARKER_KEY, '1');
      }, failure),
    clear: () =>
      attempt(() => {
        Storage.removeItemSync(INSTALL_MARKER_KEY);
      }, failure),
  };
}
