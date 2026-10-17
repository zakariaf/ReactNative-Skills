// src/services/secure-storage/fake-secure-storage.ts
// In-memory SecureStoragePort for tests: seed values, make one operation fail, hold writes open to
// test interleavings, and read back every call in order.
import { err, ok } from '@/core/result';

import type { SecureKey } from './secure-key-names';
import type { SecureStorageFailure, SecureStoragePort } from './secure-storage-port';

export type SecureStorageCall =
  | { readonly operation: 'read' | 'remove'; readonly key: SecureKey }
  | { readonly operation: 'write'; readonly key: SecureKey; readonly value: string };

export type FakeSecureStore = SecureStoragePort & {
  /** Every call, oldest first (writes with their value, so a test can check the order). */
  readonly calls: readonly SecureStorageCall[];
  /** What is stored now. */
  readonly stored: () => ReadonlyMap<SecureKey, string>;
  /** From now on, this operation fails (null: nothing fails). */
  readonly failNext: (operation: SecureStorageFailure['operation'] | null) => void;
  /** Holds every following write until the returned function is called (interleaving tests). */
  readonly holdWrites: () => () => void;
};

/** A gate that holds writes: `wait()` resolves at once until `hold()`, then when released. */
function createWriteGate(): {
  readonly wait: () => Promise<void>;
  readonly hold: () => () => void;
} {
  let gate: Promise<void> | null = null;
  return {
    wait: () => gate ?? Promise.resolve(),
    hold: () => {
      let release: () => void = () => undefined;
      gate = new Promise((resolve) => {
        release = resolve;
      });
      return () => {
        gate = null;
        release();
      };
    },
  };
}

export function createFakeSecureStorage(
  seed: Readonly<Partial<Record<SecureKey, string>>> = {},
): FakeSecureStore {
  const values = new Map<SecureKey, string>(Object.entries(seed) as [SecureKey, string][]);
  const calls: SecureStorageCall[] = [];
  let failing: SecureStorageFailure['operation'] | null = null;
  const gate = createWriteGate();
  const refuse = (operation: SecureStorageFailure['operation']): boolean => failing === operation;
  const failure = (operation: SecureStorageFailure['operation']) =>
    err<SecureStorageFailure>({ kind: 'secure-storage-unavailable', operation });
  return {
    calls,
    stored: () => new Map(values),
    failNext: (operation) => {
      failing = operation;
    },
    holdWrites: gate.hold,
    read: (key) => {
      calls.push({ operation: 'read', key });
      return Promise.resolve(refuse('read') ? failure('read') : ok(values.get(key) ?? null));
    },
    write: async (key, value) => {
      calls.push({ operation: 'write', key, value });
      await gate.wait();
      if (refuse('write')) return failure('write');
      values.set(key, value);
      return ok(undefined);
    },
    remove: (key) => {
      calls.push({ operation: 'remove', key });
      if (refuse('remove')) return Promise.resolve(failure('remove'));
      values.delete(key);
      return Promise.resolve(ok(undefined));
    },
  };
}
