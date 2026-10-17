// src/data/expo-sqlite-sql-driver.ts: the SqlDriver over expo-sqlite's synchronous API (devices only).
// device-only: covered by the kill test (kill-test.mjs); the same SQL runs on node:sqlite in test/sqlite/, and
// test/sqlite/sql-driver-contract.test.ts runs wrapSyncSqliteDatabase over node:sqlite.
import { openDatabaseSync } from 'expo-sqlite';

import { NESTED_TRANSACTION_MESSAGE } from '@/data/sql-driver';

import type { ClosableSqlDriver, SqlRow } from '@/data/sql-driver';
import type { SQLiteBindValue, SQLiteRunResult } from 'expo-sqlite';

export type ExpoSqliteDriverOptions = {
  /** A separate connection (a read-only peek) that closing never takes from the main one. */
  readonly useNewConnection?: boolean;
};

/** The synchronous part of expo-sqlite's SQLiteDatabase this driver uses (rows as plain objects). */
export type SyncSqliteDatabase = {
  readonly databasePath: string;
  readonly execSync: (source: string) => void;
  readonly runSync: (source: string, params: SQLiteBindValue[]) => SQLiteRunResult;
  readonly getFirstSync: (source: string, params: SQLiteBindValue[]) => SqlRow | null;
  readonly getAllSync: (source: string, params: SQLiteBindValue[]) => SqlRow[];
  readonly isInTransactionSync: () => boolean;
  readonly closeSync: () => void;
};

/**
 * The SqlDriver over an open database. transaction() is written out instead of calling
 * withTransactionSync (expo-sqlite 57.0.3), whose ROLLBACK also runs when BEGIN failed or SQLite
 * already rolled back a failed COMMIT: that second error ('cannot rollback - no transaction is
 * active') replaced the first, and a nested call rolled back the outer transaction.
 */
export function wrapSyncSqliteDatabase(db: SyncSqliteDatabase): ClosableSqlDriver {
  return {
    path: db.databasePath,
    exec: (sql) => {
      db.execSync(sql);
    },
    run: (sql, params) => {
      const { changes, lastInsertRowId } = db.runSync(sql, [...params]);
      return { changes, lastInsertRowId };
    },
    get: (sql, params) => db.getFirstSync(sql, [...params]),
    all: (sql, params) => db.getAllSync(sql, [...params]),
    transaction: (work) => {
      if (db.isInTransactionSync()) throw new Error(NESTED_TRANSACTION_MESSAGE);
      db.execSync('BEGIN');
      try {
        work();
        db.execSync('COMMIT');
      } catch (error) {
        if (db.isInTransactionSync()) db.execSync('ROLLBACK');
        throw error;
      }
    },
    close: () => {
      db.closeSync();
    },
  };
}

/**
 * Opens `fileName` in expo-sqlite's default directory (iOS: <container>/Documents/SQLite/,
 * Android: <files dir>/SQLite/), or an in-memory database for ':memory:'.
 */
export function createExpoSqliteSqlDriver(
  fileName: string,
  options: ExpoSqliteDriverOptions = {},
): ClosableSqlDriver {
  return wrapSyncSqliteDatabase(openDatabaseSync(fileName, options));
}
