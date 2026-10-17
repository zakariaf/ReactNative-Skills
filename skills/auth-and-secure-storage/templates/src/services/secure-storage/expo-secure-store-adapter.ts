// src/services/secure-storage/expo-secure-store-adapter.ts
// The SecureStoragePort on expo-secure-store, and the only app file that imports it. iOS keeps each
// value as a Keychain generic password; Android encrypts it with a Keystore key and keeps the
// ciphertext in SharedPreferences. Every call passes the same options object: a value written with
// one keychainService or accessibility is found only with the same options, and iOS keeps the
// accessibility an item was first written with (an update changes the data, not the attribute).
import * as SecureStore from 'expo-secure-store';

import { attemptAsync } from '@/core/result';

import type { SecureKey } from './secure-key-names';
import type { SecureStorageFailure, SecureStoragePort } from './secure-storage-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

/**
 * AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: readable in the background once the phone was unlocked after
 * a restart (a refresh from a background task works; the default WHEN_UNLOCKED fails there), and
 * never restored to another device from a backup. No requireAuthentication: Android would then ask
 * for a biometric prompt on every read, including the silent refresh.
 */
export const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = Object.freeze({
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
});

export type ExpoSecureStoreAdapterDeps = {
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
};

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

export function createExpoSecureStoreAdapter({
  errorLog,
}: ExpoSecureStoreAdapterDeps): SecureStoragePort {
  // Records the cause with the key, never the value, and returns the failure the port promises.
  const failure =
    (operation: SecureStorageFailure['operation'], key: SecureKey) =>
    (thrown: unknown): SecureStorageFailure => {
      errorLog.record(
        'storage',
        new Error(`secure store ${operation} ${key}: ${messageOf(thrown)}`),
      );
      return { kind: 'secure-storage-unavailable', operation };
    };
  return {
    read: (key) =>
      attemptAsync(() => SecureStore.getItemAsync(key, SECURE_STORE_OPTIONS), failure('read', key)),
    write: (key, value) =>
      attemptAsync(
        () => SecureStore.setItemAsync(key, value, SECURE_STORE_OPTIONS),
        failure('write', key),
      ),
    remove: (key) =>
      attemptAsync(
        () => SecureStore.deleteItemAsync(key, SECURE_STORE_OPTIONS),
        failure('remove', key),
      ),
  };
}
