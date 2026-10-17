// src/data/reset-data.ts: "Delete all my data": every user table except the protected ones, in one transaction.
import { attempt } from '@/core/result';
import { toStorageFailure } from '@/data/to-storage-failure';

import type { Result } from '@/core/result';
import type { SqlDriver } from '@/data/sql-driver';
import type { StorageFailure } from '@/data/to-storage-failure';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

/**
 * Children before parents (foreign keys). Kept on purpose, and named in contracts/persistence.json:
 * entitlements (a purchase ends only with a dated revocation from the store, never with a reset)
 * and error_log (the diagnostics a support request needs).
 */
const RESET_SQL = ['DELETE FROM tasks', 'DELETE FROM lists'] as const;

/** The transaction itself. It throws; features call AppData's resetAllData (below) instead. */
export function resetAllData(driver: SqlDriver): void {
  driver.transaction(() => {
    for (const sql of RESET_SQL) driver.run(sql, []);
  });
}

/**
 * AppData's `resetAllData`: the same one transaction as a Result, the throw converted once, here.
 * The raw error is recorded first, because past this line only the StorageFailure exists. A failed
 * reset rolled back: every row is still there, so the caller publishes nothing.
 */
export function createResetAllData(
  driver: SqlDriver,
  errorLog: Pick<ErrorLogPort, 'record'>,
): () => Result<void, StorageFailure> {
  return () =>
    attempt(
      () => {
        resetAllData(driver);
      },
      (thrown): StorageFailure => {
        errorLog.record('storage', thrown);
        return toStorageFailure(thrown);
      },
    );
}
