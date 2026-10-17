// src/data/peek-database.ts: a read-only look at the database before startup makes a decision that can reload the app.
// device-only: covered by the flow that restarts the app into its saved language; the reads run on node:sqlite in tests.
import { APP_DB_FILE } from '@/data/app-database';
import { createExpoSqliteSqlDriver } from '@/data/expo-sqlite-sql-driver';

import type { ClosableSqlDriver, SqlDriver } from '@/data/sql-driver';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

/** What a peek may do: read. No DDL, no pragma, no migration, no write. */
export type SqlReader = Pick<SqlDriver, 'get' | 'all'>;

/**
 * Opens its own connection, reads, closes. Module code runs again after a reload, so anything
 * written here would be written twice. It never throws: a first launch has no tables yet, so a
 * failed read records the error (the session's memory log) and gives the fallback.
 */
export function peekDatabase<T>(
  read: (reader: SqlReader) => T,
  fallback: T,
  errorLog: Pick<ErrorLogPort, 'record'>,
): T {
  let driver: ClosableSqlDriver | null = null;
  try {
    driver = createExpoSqliteSqlDriver(APP_DB_FILE, { useNewConnection: true });
    return read({ get: driver.get, all: driver.all });
  } catch (error: unknown) {
    errorLog.record('storage', error);
    return fallback;
  } finally {
    driver?.close();
  }
}
