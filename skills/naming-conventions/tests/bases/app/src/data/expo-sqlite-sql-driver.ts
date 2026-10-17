// src/data/expo-sqlite-sql-driver.ts
import type { SqlDriver } from './sql-driver';

export function createExpoSqliteSqlDriver(): SqlDriver {
  return { run: () => undefined, all: () => [] };
}
