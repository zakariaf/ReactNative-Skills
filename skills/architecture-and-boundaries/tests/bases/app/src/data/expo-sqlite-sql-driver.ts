import { openDatabaseSync } from 'expo-sqlite';

import type { SqlDriver } from './sql-driver';

export function createExpoSqliteSqlDriver(name: string): SqlDriver {
  const db = openDatabaseSync(name);
  return { exec: (sql) => db.execSync(sql), run: (sql, params) => db.runSync(sql, [...params]) };
}
