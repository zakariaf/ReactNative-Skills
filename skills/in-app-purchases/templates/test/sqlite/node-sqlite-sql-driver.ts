// test/sqlite/node-sqlite-sql-driver.ts: the SqlDriver over Node's built-in node:sqlite, so Jest runs the app's real SQL.
import { DatabaseSync } from 'node:sqlite';

import { NESTED_TRANSACTION_MESSAGE } from '@/data/sql-driver';

import type { ClosableSqlDriver, SqlRow } from '@/data/sql-driver';

/** node:sqlite rows have a null prototype; a plain copy keeps toStrictEqual honest. */
function plain(row: object): SqlRow {
  return { ...row };
}

/**
 * Opens `path` (or ':memory:') the way a device opens it: foreign keys stay off until the app's
 * own pragmas turn them on. node:sqlite enables them by default and the SQLite that expo-sqlite
 * bundles does not, so without this option a test would pass that the device fails. transaction()
 * behaves exactly like the device driver's (sql-driver-contract.test.ts runs both).
 */
export function createNodeSqliteSqlDriver(path: string): ClosableSqlDriver {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  /** Read fresh each time: work() and a failed COMMIT change it. */
  const isInTransaction = (): boolean => db.isTransaction;
  return {
    path,
    exec: (sql) => {
      db.exec(sql);
    },
    run: (sql, params) => {
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    get: (sql, params) => {
      const row = db.prepare(sql).get(...params);
      return row === undefined ? null : plain(row);
    },
    all: (sql, params) =>
      db
        .prepare(sql)
        .all(...params)
        .map(plain),
    transaction: (work) => {
      if (isInTransaction()) throw new Error(NESTED_TRANSACTION_MESSAGE);
      db.exec('BEGIN');
      try {
        work();
        db.exec('COMMIT');
      } catch (error) {
        if (isInTransaction()) db.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => {
      db.close();
    },
  };
}
