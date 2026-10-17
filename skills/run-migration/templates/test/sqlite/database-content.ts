// test/sqlite/database-content.ts: a database's whole content as one comparable value (version, schema, every row), and its row counts.
import { schemaOf, userTables } from '@/data/database-schema';

import type { SqlDriver, SqlRow } from '@/data/sql-driver';

export type DatabaseContent = {
  readonly version: unknown;
  readonly schema: readonly SqlRow[];
  /** Every row of every user table, in a stable order. */
  readonly rows: Readonly<Record<string, readonly SqlRow[]>>;
};

type Reader = Pick<SqlDriver, 'all' | 'get'>;

/** A table or column name as an SQL identifier (names come from sqlite_master, never from input). */
function quoted(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Every row of `table`, ordered by all its columns left to right, so two copies of one database
 * compare exactly whatever order their pages hold the rows in.
 */
export function rowsOf(driver: Pick<SqlDriver, 'all'>, table: string): readonly SqlRow[] {
  const columns = driver
    .all('SELECT name FROM pragma_table_info(?)', [table])
    .map((column) => quoted(String(column['name'])));
  return driver.all(`SELECT * FROM ${quoted(table)} ORDER BY ${columns.join(', ')}`, []);
}

/** user_version, the schema and every row: equal values mean the same data, byte for byte. */
export function contentOf(driver: Reader): DatabaseContent {
  const rows = Object.fromEntries(
    userTables(driver).map((table) => [table, rowsOf(driver, table)]),
  );
  return {
    version: driver.get('PRAGMA user_version', [])?.['user_version'],
    schema: schemaOf(driver),
    rows,
  };
}

/** Rows per user table. */
export function countsOf(driver: Reader): Readonly<Record<string, number>> {
  return Object.fromEntries(
    userTables(driver).map((table) => [
      table,
      Number(driver.get(`SELECT COUNT(*) AS n FROM ${quoted(table)}`, [])?.['n']),
    ]),
  );
}

/** Tables that exist before and after and hold fewer rows after: '<after> of <before>'. */
export function lostRows(
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(before)
      .filter(([table, count]) => table in after && (after[table] ?? 0) < count)
      .map(([table, count]) => [table, `${String(after[table])} of ${String(count)}`]),
  );
}
