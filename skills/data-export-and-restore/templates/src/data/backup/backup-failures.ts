// src/data/backup/backup-failures.ts: one failure kind per reason an export or a restore stops, so the screen can say which.
import type { BackupTable } from '@/data/backup/backup-schema';
import type { StorageFailure } from '@/data/to-storage-failure';

/** Rows contradict each other: a repeated id, or a child whose parent is not in the file. */
export type Inconsistency = {
  readonly kind: 'inconsistent';
  readonly table: BackupTable;
  readonly id: number;
  readonly reason: 'duplicate-id' | 'missing-parent';
};

/** Larger than MAX_BACKUP_BYTES: export refuses to write it and restore refuses to read it. */
export type TooLarge = {
  readonly kind: 'too-large';
  readonly sizeBytes: number;
  readonly maxBytes: number;
};

/**
 * Why a picked file is not restored, in the order the ladder checks (read-backup.ts). Every kind
 * leaves the database exactly as it was. The screen maps each kind to its own message: "Restore
 * failed" alone cannot be told apart from data loss.
 */
export type RestoreFailure =
  /** The picked file could not be read (permissions, a cloud file that never downloaded). */
  | { readonly kind: 'unreadable' }
  /** Larger than MAX_BACKUP_BYTES: refused before it is read into memory. */
  | TooLarge
  /** Empty, not JSON, or another format: a CSV export, another app's file. Never restorable. */
  | { readonly kind: 'not-a-backup' }
  /** Our header, but truncated, edited, or the checksum does not match the payload. */
  | { readonly kind: 'damaged' }
  /** A newer envelope shape than this build reads: update the app. */
  | { readonly kind: 'newer-format'; readonly found: number; readonly supported: number }
  /** Written by a newer schema than this build: update the app (appVersion names the writer). */
  | {
      readonly kind: 'newer-version';
      readonly found: number;
      readonly supported: number;
      readonly appVersion: string;
    }
  /** Older than the first schema this build can upgrade from. */
  | { readonly kind: 'too-old'; readonly found: number; readonly oldest: number }
  /** A row breaks the payload schema; `path` is the first offending field ('tasks.3.title'). */
  | { readonly kind: 'invalid-row'; readonly path: string }
  /** Rows contradict each other (Inconsistency). */
  | Inconsistency
  /**
   * The database could not be opened and this session runs in memory (DatabaseStatus.isPersistent
   * false): a restore would vanish at the next start, so it is refused. Export still works.
   */
  | { readonly kind: 'session-in-memory' }
  /** The copy of the current data that restore writes first failed, so nothing was replaced. */
  | { readonly kind: 'safety-copy-failed' }
  /** This preview was already restored (a second tap on Replace): nothing ran twice. */
  | { readonly kind: 'already-restored' }
  /** The replace transaction failed and rolled back: every current row is still there. */
  | { readonly kind: 'storage'; readonly failure: StorageFailure };

/** Why an export produced no file. A failed export never leaves a partial file behind. */
export type ExportFailure =
  | { readonly kind: 'storage'; readonly failure: StorageFailure }
  /**
   * The backup would be larger than MAX_BACKUP_BYTES, which restore refuses: a file that could never
   * be restored is not written. Nothing is published.
   */
  | TooLarge
  /** The rows read would make a file that fails its own restore (rung 7); nothing is published. */
  | Inconsistency
  | { readonly kind: 'no-space'; readonly neededBytes: number; readonly availableBytes: number }
  | { readonly kind: 'write-failed' };

/** Rows per table, for the confirmation ("replaces 12 tasks with 40") and the report. */
export type BackupCounts = Readonly<Record<BackupTable, number>>;
