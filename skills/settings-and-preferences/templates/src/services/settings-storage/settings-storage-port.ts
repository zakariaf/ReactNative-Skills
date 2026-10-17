// src/services/settings-storage/settings-storage-port.ts
// Where the settings text lives between launches. Synchronous on purpose: the settings store reads
// it before the first paint, so the first frame already has the saved theme and language. Adapter:
// kv-settings-storage-adapter.ts (expo-sqlite/kv-store). Fake: fake-settings-storage.ts.
import type { Result } from '@/core/result';

export type SettingsReadFailure = { readonly kind: 'settings-unreadable' };
export type SettingsWriteFailure = { readonly kind: 'settings-not-saved' };

/**
 * Reads and replaces the saved settings text synchronously and never throws: an unexpected failure
 * is recorded by the adapter and returned as a failure value.
 */
export type SettingsStoragePort = {
  /** The saved text, or null before the first save. The adapter records an unexpected failure. */
  readonly read: () => Result<string | null, SettingsReadFailure>;
  /** Replaces the saved text in one atomic write. The adapter records an unexpected failure. */
  readonly write: (text: string) => Result<void, SettingsWriteFailure>;
};
