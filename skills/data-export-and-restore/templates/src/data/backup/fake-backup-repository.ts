// src/data/backup/fake-backup-repository.ts: an in-memory BackupRepository for service and screen tests.
import { err, ok } from '@/core/result';

import type { BackupRepository, BackupWriteFailure } from '@/data/backup/backup-repository';
import type { BackupPayload } from '@/data/backup/backup-schema';
import type { StorageFailure } from '@/data/to-storage-failure';

export type FakeBackupRepository = BackupRepository & {
  /** The rows the fake holds now. */
  readonly current: () => BackupPayload;
  /** How many times replaceAll ran (a test asserts a refused restore never reached it). */
  readonly replaceCount: () => number;
  /** The next readAll or replaceAll fails with this storage failure, once. */
  readonly failNext: (failure: StorageFailure) => void;
  /** Every readAll from now on reports this many unreadable rows (left out of the payload). */
  readonly skipRows: (count: number) => void;
};

export const EMPTY_BACKUP_PAYLOAD: BackupPayload = { lists: [], tasks: [] };

export function createFakeBackupRepository(
  initial: BackupPayload = EMPTY_BACKUP_PAYLOAD,
): FakeBackupRepository {
  let rows = initial;
  let replaces = 0;
  let nextFailure: StorageFailure | null = null;
  let skippedRows = 0;
  const takeFailure = (): StorageFailure | null => {
    const failure = nextFailure;
    nextFailure = null;
    return failure;
  };
  return {
    current: () => rows,
    replaceCount: () => replaces,
    failNext: (failure) => {
      nextFailure = failure;
    },
    skipRows: (count) => {
      skippedRows = count;
    },
    readAll: () => {
      const failure = takeFailure();
      return failure === null ? ok({ payload: rows, skippedRows }) : err(failure);
    },
    replaceAll: (payload) => {
      replaces += 1;
      const failure = takeFailure();
      if (failure !== null) return err<BackupWriteFailure>({ kind: 'storage', failure });
      rows = payload;
      return ok({ lists: payload.lists.length, tasks: payload.tasks.length });
    },
  };
}
