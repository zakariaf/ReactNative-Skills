// src/data/backup/backup-schema.ts: what a backup holds (the user's tables at the latest schema) and what it never holds.
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

/**
 * The largest instant a JavaScript Date can hold (ECMAScript: 8.64e15 ms after 1970). The tables
 * accept any safe integer, but a file is edited by hand: a larger value would make the CSV export's
 * toISOString() throw, so a backup refuses it at read time instead.
 */
export const EPOCH_MS_MAX = 8_640_000_000_000_000;

const epochMs = v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(EPOCH_MS_MAX));

/** A lists row as the table holds it: the column names and canonical values, never display text. */
export const BACKUP_LIST = v.strictObject({
  ...LIST_ROW.entries,
  name: codePoints(1, 80),
  created_at_ms: epochMs,
});

/** A tasks row as the table holds it (is_done is 0 or 1, created_at_ms epoch milliseconds UTC). */
export const BACKUP_TASK = v.strictObject({
  ...TASK_ROW.entries,
  title: codePoints(1, 200),
  created_at_ms: epochMs,
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
