// src/data/reset-data.ts: "Delete all data": every user table except the protected ones, in one transaction.
import type { SqlDriver } from '@/data/sql-driver';

/** Children before parents (foreign keys). The settings live in the key-value store, never here. */
const RESET_SQL = ['DELETE FROM tasks', 'DELETE FROM lists'] as const;

export function resetAllData(driver: SqlDriver): void {
  driver.transaction(() => {
    for (const sql of RESET_SQL) driver.run(sql, []);
  });
}
