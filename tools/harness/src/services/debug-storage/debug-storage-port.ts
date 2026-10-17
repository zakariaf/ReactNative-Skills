// src/services/debug-storage/debug-storage-port.ts
// Where a test build keeps its debug switches across a reload or a kill: one text value in a store
// apart from the app's own data, read synchronously before the first render. Test-only: only the
// test-only entry creates the adapter (kv-debug-storage-adapter.ts); tests use fake-debug-storage.ts.
import type { Result } from '@/core/result';

export type DebugStorageFailure =
  { readonly kind: 'debug-storage-unreadable' } | { readonly kind: 'debug-storage-not-saved' };

/** Synchronous on purpose: the clock answers the simulated day from the first render. */
export type DebugStoragePort = {
  /** The stored text, or null when nothing is stored. Never throws. */
  readonly read: () => Result<string | null, DebugStorageFailure>;
  /** Stores the text, or removes it with null. Never throws. */
  readonly write: (text: string | null) => Result<void, DebugStorageFailure>;
};
