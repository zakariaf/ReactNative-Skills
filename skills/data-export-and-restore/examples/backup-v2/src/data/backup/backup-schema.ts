// src/data/backup/backup-schema.ts: what a backup holds (the user's tables at the latest schema) and what it never holds.
// examples/backup-v2: schema 2, where tasks carry due_on (a 'YYYY-MM-DD' local date key or null).
import * as v from 'valibot';

import { LIST_ROW, TASK_ROW } from '@/data/tasks/task-schema';

/**
 * SQLite's length() counts characters (code points); JavaScript's .length counts UTF-16 units, so
 * an emoji is 1 to the database and 2 to v.maxLength. A backup must accept every value the tables'
 * CHECK constraints accept, so text bounds here count code points, exactly as the CHECK does.
 */
const codePoints = (min: number, max: number) =>
  v.pipe(
    v.string(),
    v.check(
      (text) => {
        const length = Array.from(text).length;
        return length >= min && length <= max;
      },
      `length must be ${String(min)} to ${String(max)} characters`,
    ),
  );

/** A lists row as the table holds it: the column names and canonical values, never display text. */
export const BACKUP_LIST = v.strictObject({ ...LIST_ROW.entries, name: codePoints(1, 80) });

/** A tasks row as the table holds it (is_done is 0 or 1, created_at_ms epoch milliseconds UTC). */
export const BACKUP_TASK = v.strictObject({
  ...TASK_ROW.entries,
  title: codePoints(1, 200),
  due_on: v.nullable(v.pipe(v.string(), v.regex(/^\d{4}-[01]\d-[0-3]\d$/))),
});

/**
 * The payload at BACKUP_SCHEMA_VERSION (= the database's LATEST_DB_VERSION): one array per user
 * table, rows ordered by id, values verbatim. A new user table is added here in the same change
 * as its migration (or to BACKUP_EXCLUDED_TABLES with its reason); check-backup's backup-coverage
 * rule compares this object with the tables the migrations create.
 */
export const BACKUP_PAYLOAD = v.strictObject({
  lists: v.array(BACKUP_LIST),
  tasks: v.array(BACKUP_TASK),
});

export type BackupPayload = v.InferOutput<typeof BACKUP_PAYLOAD>;
export type BackupTable = keyof BackupPayload;

/** Restore writes parents before children and clears children before parents (foreign keys). */
export const BACKUP_TABLES_IN_WRITE_ORDER: readonly BackupTable[] = ['lists', 'tasks'];

/**
 * Tables a backup never holds, with the reason. A backup is a file the user can edit: restoring
 * entitlements would grant a purchase nobody made (a purchase comes back only from the store's
 * restore), and error_log is this device's diagnostics, not the user's data.
 */
export const BACKUP_EXCLUDED_TABLES = {
  entitlements: 'purchases come back only through the store (in-app-purchases restore)',
  error_log: "this device's diagnostics, not the user's data",
} as const;
