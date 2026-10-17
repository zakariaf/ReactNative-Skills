// src/services/settings-storage/fake-settings-storage.ts
// In-memory SettingsStoragePort for tests: seed the saved text, make reads or writes fail, and
// read back every write in order.
import { err, ok } from '@/core/result';

import type { SettingsStoragePort } from '@/services/settings-storage/settings-storage-port';

export type FakeSettingsStorage = SettingsStoragePort & {
  /** Every text written, oldest first. */
  readonly writes: readonly string[];
  /** The text a read returns now. */
  readonly saved: () => string | null;
};

export type FakeSettingsStorageOptions = {
  readonly text?: string | null;
  readonly isReadFailing?: boolean;
  readonly isWriteFailing?: boolean;
};

export function createFakeSettingsStorage(
  options: FakeSettingsStorageOptions = {},
): FakeSettingsStorage {
  let text = options.text ?? null;
  const writes: string[] = [];
  return {
    writes,
    saved: () => text,
    read: () => (options.isReadFailing === true ? err({ kind: 'settings-unreadable' }) : ok(text)),
    write: (next) => {
      if (options.isWriteFailing === true) return err({ kind: 'settings-not-saved' });
      text = next;
      writes.push(next);
      return ok(undefined);
    },
  };
}
