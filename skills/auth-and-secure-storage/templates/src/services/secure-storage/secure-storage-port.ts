// src/services/secure-storage/secure-storage-port.ts
// Where secrets live between launches: the iOS Keychain and Android's Keystore-encrypted storage.
// Asynchronous on purpose (a keychain read can wait for the device to unlock) and closed over the
// declared keys, so nothing secret is stored under a key a wipe does not know. Adapter:
// expo-secure-store-adapter.ts (the only importer of expo-secure-store). Fake: fake-secure-store.ts.
import type { SecureKey } from './secure-key-names';
import type { Result } from '@/core/result';

/**
 * The store could not do it now: the device has not been unlocked since it started, the keystore
 * refused, or the platform rejected the value. The adapter records the cause; callers decide what a
 * missing answer means, and a failed read is never "nothing stored".
 */
export type SecureStorageFailure = {
  readonly kind: 'secure-storage-unavailable';
  readonly operation: 'read' | 'write' | 'remove';
};

/** Reads, writes and removes one secret. Never rejects: every outcome is a Result. */
export type SecureStoragePort = {
  /** The stored value, or null when nothing is stored under the key. */
  readonly read: (key: SecureKey) => Promise<Result<string | null, SecureStorageFailure>>;
  readonly write: (key: SecureKey, value: string) => Promise<Result<void, SecureStorageFailure>>;
  /** Removing a key that holds nothing is a success. */
  readonly remove: (key: SecureKey) => Promise<Result<void, SecureStorageFailure>>;
};
