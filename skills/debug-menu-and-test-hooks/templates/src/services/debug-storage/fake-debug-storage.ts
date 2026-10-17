// src/services/debug-storage/fake-debug-storage.ts
// Jest only: a DebugStoragePort in memory, whose reads or writes a test can make fail.
import { err, ok } from '@/core/result';

import type { DebugStoragePort } from '@/services/debug-storage/debug-storage-port';

export type FakeDebugStorage = DebugStoragePort & {
  /** What is stored right now. */
  readonly stored: () => string | null;
  /** Makes every read ('read'), every write ('write') or nothing (null) fail from now on. */
  readonly failOn: (operation: 'read' | 'write' | null) => void;
};

export function createFakeDebugStorage(initial: string | null = null): FakeDebugStorage {
  let text = initial;
  let failing: 'read' | 'write' | null = null;
  return {
    read: () => (failing === 'read' ? err({ kind: 'debug-storage-unreadable' }) : ok(text)),
    write: (next) => {
      if (failing === 'write') return err({ kind: 'debug-storage-not-saved' });
      text = next;
      return ok(undefined);
    },
    stored: () => text,
    failOn: (operation) => {
      failing = operation;
    },
  };
}
