// src/data/backup/backup-repository.ts: what export and restore need from the database, as a type (SQLite and fake implement it).
import type { Result } from '@/core/result';
import type { BackupCounts } from '@/data/backup/backup-failures';
import type { BackupPayload } from '@/data/backup/backup-schema';
import type { StorageFailure } from '@/data/to-storage-failure';

/** Every user table's rows, and how many rows were unreadable (logged, left out, and reported). */
export type BackupSnapshot = {
  readonly payload: BackupPayload;
  readonly skippedRows: number;
};

export type BackupWriteFailure =
  /** The payload broke its schema: a programmer error, since readBackup validated it first. */
  | { readonly kind: 'invalid-input'; readonly path: string }
  /** The transaction failed and rolled back: the tables are exactly as before. */
  | { readonly kind: 'storage'; readonly failure: StorageFailure };

export type BackupRepository = {
  /** Reads every row of every backed-up table, ordered by id. */
  readonly readAll: () => Result<BackupSnapshot, StorageFailure>;
  /**
   * Replace policy: in ONE transaction, deletes every row of every backed-up table and inserts the
   * payload's rows with their ids. All of it commits, or none of it does. Never touches a table in
   * BACKUP_EXCLUDED_TABLES.
   */
  readonly replaceAll: (payload: BackupPayload) => Result<BackupCounts, BackupWriteFailure>;
};
