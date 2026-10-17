// src/data/open-device-database.ts: the device composition of the data layer (expo-sqlite, the app's migrations, the repositories).
// device-only: covered by the kill test (kill-test.mjs); openAppDatabase itself is tested on node:sqlite.
import { APP_DB_FILE, databaseStatusOf, openAppDatabase } from '@/data/app-database';
import { createExpoFileSystemDatabaseFilesAdapter } from '@/data/expo-file-system-database-files-adapter';
import { createExpoSqliteSqlDriver } from '@/data/expo-sqlite-sql-driver';
import { BASELINE, MIGRATIONS } from '@/data/migrations/migrations';
import { createResetAllData } from '@/data/reset-data';
import { createSqliteTaskRepository } from '@/data/tasks/sqlite-task-repository';
import { createSqliteErrorLogAdapter } from '@/services/error-log/sqlite-error-log-adapter';

import type { AppData } from '@/data/app-data-context';
import type { AppDatabase } from '@/data/app-database';
import type { ClockPort } from '@/services/clock/clock-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

/**
 * Called once by the app's startup, after any decision that can reload the JavaScript runtime
 * (a direction change, an update) and before the first screen renders. Never at import time.
 * `errorLog` is the session's memory log: the SQLite one needs this database first.
 */
export function openDeviceDatabase(errorLog: Pick<ErrorLogPort, 'record'>): AppDatabase {
  return openAppDatabase({
    openDriver: (fileName) => createExpoSqliteSqlDriver(fileName),
    files: createExpoFileSystemDatabaseFilesAdapter(),
    fileName: APP_DB_FILE,
    migrations: MIGRATIONS,
    errorLog,
    baseline: BASELINE,
  });
}

export type DeviceDataServices = {
  readonly clock: ClockPort;
  /** The session's memory log (created first): it records the open and takes what SQLite cannot. */
  readonly errorLog: ErrorLogPort;
};

/**
 * The whole data layer for the root layout's first render: the database's status, the SQLite error
 * log over it, one repository per area and the data reset. Add a line here for each new repository.
 * The driver stays here: AppData carries only the status, so no feature can run a statement.
 */
export function openDeviceData(services: DeviceDataServices): AppData {
  const database = openDeviceDatabase(services.errorLog);
  const { driver } = database;
  const errorLog = createSqliteErrorLogAdapter({
    driver,
    clock: services.clock,
    fallback: services.errorLog,
  });
  return {
    database: databaseStatusOf(database),
    errorLog,
    tasks: createSqliteTaskRepository({ driver, clock: services.clock, errorLog }),
    resetAllData: createResetAllData(driver, errorLog),
  };
}
