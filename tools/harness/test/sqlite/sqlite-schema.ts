// test/sqlite/sqlite-schema.ts: what the SQL tests compare: the schema (as the open path reads it) and the health of a database.
import type { SqlDriver } from '@/data/sql-driver';

export { schemaOf } from '@/data/database-schema';

/** PRAGMA integrity_check and foreign_key_check as one comparable value: { integrity: ['ok'], orphans: 0 } when healthy. */
export function healthOf(driver: Pick<SqlDriver, 'all'>): {
  readonly integrity: readonly unknown[];
  readonly orphans: number;
} {
  const integrity = driver.all('PRAGMA integrity_check', []).map((row) => row['integrity_check']);
  return { integrity, orphans: driver.all('PRAGMA foreign_key_check', []).length };
}
