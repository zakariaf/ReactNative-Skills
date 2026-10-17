// src/data/database-schema.ts: what a database holds, read from sqlite_master (no writes): its objects and comparable schema.
import type { SqlDriver, SqlRow } from '@/data/sql-driver';

const SCHEMA_SQL = `
SELECT type, name, tbl_name AS tableName, sql FROM sqlite_master
WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`;

const USER_TABLES_SQL = `
SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`;

/**
 * Tables, indexes, triggers and views without SQLite's own objects. SQLite stores each CREATE text
 * verbatim and ALTER TABLE rewrites it the same way on every path, so two lists compare exactly.
 */
export function schemaOf(driver: Pick<SqlDriver, 'all'>): readonly SqlRow[] {
  return driver.all(SCHEMA_SQL, []);
}

/** The app's own tables (empty for a new file): a file with any holds data worth a snapshot. */
export function userTables(driver: Pick<SqlDriver, 'all'>): readonly string[] {
  return driver.all(USER_TABLES_SQL, []).map((row) => String(row['name']));
}

/** Same objects with the same CREATE text, in the same order. */
export function isSameSchema(first: readonly SqlRow[], second: readonly SqlRow[]): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}
