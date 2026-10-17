// src/data/expo-sqlite-sql-driver.ts
// device-only: covered by the e2e flow open-tasks.yaml and the device kill test; Jest runs the SQL on node:sqlite.
import { openDatabaseSync } from 'expo-sqlite';

export function openTasksDatabase(fileName: string): { readonly close: () => void } {
  const db = openDatabaseSync(fileName);
  return { close: () => db.closeSync() };
}
