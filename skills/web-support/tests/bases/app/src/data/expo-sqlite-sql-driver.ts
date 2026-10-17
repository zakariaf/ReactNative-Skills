// src/data/expo-sqlite-sql-driver.ts
import { openDatabaseSync } from 'expo-sqlite';

export function createExpoSqliteSqlDriver(fileName: string): { readonly path: string } {
  return { path: openDatabaseSync(fileName).databasePath };
}
