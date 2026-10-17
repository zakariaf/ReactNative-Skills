// src/data/sql-driver.ts: the whole SQL surface of the app, as a port (expo-sqlite on devices, node:sqlite in tests).

/** Values the app binds: no blobs, no booleans (store 0 and 1), no undefined. */
export type SqlValue = string | number | null;

/** A result row. Values stay unknown until a row schema narrows them. */
export type SqlRow = Readonly<Record<string, unknown>>;

/** What one writing statement reports. */
export type SqlRunResult = {
  /** Rows inserted, updated or deleted by the statement. */
  readonly changes: number;
  /** The rowid of the last inserted row (an INTEGER PRIMARY KEY column is that rowid). */
  readonly lastInsertRowId: number;
};

/**
 * What both drivers throw when transaction() is called inside another transaction. SQLite has no
 * nested BEGIN, and the two runtimes used to fail differently (expo-sqlite's withTransactionSync
 * rolled back the OUTER transaction), so nesting is one explicit, identical error everywhere.
 */
export const NESTED_TRANSACTION_MESSAGE =
  'SqlDriver.transaction cannot nest: run every statement of a change inside one outer transaction';

/**
 * Two implementations, one contract: src/data/expo-sqlite-sql-driver.ts (devices) and
 * test/sqlite/node-sqlite-sql-driver.ts (Jest and Node tooling); test/sqlite/sql-driver-contract.test.ts
 * runs the same cases on both. Every call is synchronous, so the app can open and migrate before its
 * first frame, and a write has committed when it returns.
 */
export type SqlDriver = {
  /** DDL and PRAGMAs; may hold several statements; takes no parameters. */
  readonly exec: (sql: string) => void;
  /** One statement that writes, with bound parameters. */
  readonly run: (sql: string, params: readonly SqlValue[]) => SqlRunResult;
  /** The first row, or null. */
  readonly get: (sql: string, params: readonly SqlValue[]) => SqlRow | null;
  /** Every row, as plain objects. */
  readonly all: (sql: string, params: readonly SqlValue[]) => readonly SqlRow[];
  /**
   * BEGIN; work(); COMMIT. When work (or COMMIT) throws: ROLLBACK if a transaction is still open,
   * then the original error is rethrown. Inside another transaction it throws
   * NESTED_TRANSACTION_MESSAGE before running anything.
   */
  readonly transaction: (work: () => void) => void;
};

/** What the driver factories return: the file path (snapshots are written next to it) and close. */
export type ClosableSqlDriver = SqlDriver & {
  /** Absolute path of the database file, or ':memory:'. */
  readonly path: string;
  readonly close: () => void;
};
