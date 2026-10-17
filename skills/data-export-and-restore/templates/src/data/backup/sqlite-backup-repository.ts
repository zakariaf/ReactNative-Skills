// src/data/backup/sqlite-backup-repository.ts: reads every backed-up table for export and replaces them all, in one transaction, on restore.
import * as v from 'valibot';

import { attempt, err, ok } from '@/core/result';
import { BACKUP_LIST, BACKUP_PAYLOAD, BACKUP_TASK } from '@/data/backup/backup-schema';
import { toStorageFailure } from '@/data/to-storage-failure';

import type { BackupRepository } from '@/data/backup/backup-repository';
import type { BackupPayload } from '@/data/backup/backup-schema';
import type { SqlDriver, SqlRow } from '@/data/sql-driver';
import type { StorageFailure } from '@/data/to-storage-failure';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

/** Ordered by id, so the same rows always give the same file. */
const SELECT_LISTS_SQL = 'SELECT id, name, created_at_ms FROM lists ORDER BY id';
const SELECT_TASKS_SQL = 'SELECT id, list_id, title, is_done, created_at_ms FROM tasks ORDER BY id';
/** Children before parents. Never entitlements or error_log (BACKUP_EXCLUDED_TABLES). */
const DELETE_TASKS_SQL = 'DELETE FROM tasks';
const DELETE_LISTS_SQL = 'DELETE FROM lists';
/** Ids are restored as they were: the file's references stay true and a second restore is idempotent. */
const INSERT_LIST_SQL = 'INSERT INTO lists (id, name, created_at_ms) VALUES (?, ?, ?)';
const INSERT_TASK_SQL =
  'INSERT INTO tasks (id, list_id, title, is_done, created_at_ms) VALUES (?, ?, ?, ?, ?)';

export type SqliteBackupRepositoryDeps = {
  readonly driver: SqlDriver;
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
};

type Readable<TRow> = { readonly rows: TRow[]; readonly skipped: number };

type RowReader<TSchema extends v.GenericSchema> = {
  readonly table: string;
  readonly schema: TSchema;
};

const LISTS: RowReader<typeof BACKUP_LIST> = { table: 'lists', schema: BACKUP_LIST };
const TASKS: RowReader<typeof BACKUP_TASK> = { table: 'tasks', schema: BACKUP_TASK };
/** A child table, how a row names its parent, and the parent ids that made it into the file. */
type ChildOf<TRow> = {
  readonly table: string;
  readonly parentOf: (row: TRow) => number;
  readonly parentIds: ReadonlySet<number>;
};

/**
 * Every row goes through its backup schema. An unreadable row is logged (the table and the field,
 * never the user's text) and counted, never a crash and never silent: the export reports how many
 * rows its file does not hold (with the children withParent leaves out).
 */
function readableRows<TSchema extends v.GenericSchema>(
  reader: RowReader<TSchema>,
  rows: readonly SqlRow[],
  errorLog: Pick<ErrorLogPort, 'record'>,
): Readable<v.InferOutput<TSchema>> {
  const readable: v.InferOutput<TSchema>[] = [];
  for (const row of rows) {
    const result = v.safeParse(reader.schema, row);
    if (result.success) {
      readable.push(result.output);
    } else {
      const field = v.getDotPath(result.issues[0]) ?? '(row)';
      errorLog.record(
        'storage',
        new Error(`backup skipped an unreadable ${reader.table} row: ${field}`),
      );
    }
  }
  return { rows: readable, skipped: rows.length - readable.length };
}

/**
 * A child whose parent row was left out is left out too, logged and counted: otherwise the file
 * would hold a task whose list is missing, and fail its own restore (rung 7, missing-parent).
 */
function withParent<TRow>(
  child: ChildOf<TRow>,
  readable: Readable<TRow>,
  errorLog: Pick<ErrorLogPort, 'record'>,
): Readable<TRow> {
  const { parentIds } = child;
  const rows = readable.rows.filter((row) => parentIds.has(child.parentOf(row)));
  const orphans = readable.rows.length - rows.length;
  if (orphans > 0) {
    errorLog.record(
      'storage',
      new Error(`backup skipped ${String(orphans)} ${child.table} rows whose parent was skipped`),
    );
  }
  return { rows, skipped: readable.skipped + orphans };
}

/** The raw error is recorded (unless the disk is simply full), then converted once. */
function storageFailureOf(errorLog: Pick<ErrorLogPort, 'record'>) {
  return (thrown: unknown): StorageFailure => {
    const failure = toStorageFailure(thrown);
    if (failure.kind !== 'full') errorLog.record('storage', thrown);
    return failure;
  };
}

/** Parents before children. Runs inside replaceAll's one transaction, never alone. */
function insertRows(driver: SqlDriver, { lists, tasks }: BackupPayload): void {
  for (const list of lists) {
    driver.run(INSERT_LIST_SQL, [list.id, list.name, list.created_at_ms]);
  }
  for (const task of tasks) {
    driver.run(INSERT_TASK_SQL, [
      task.id,
      task.list_id,
      task.title,
      task.is_done,
      task.created_at_ms,
    ]);
  }
}

export function createSqliteBackupRepository(deps: SqliteBackupRepositoryDeps): BackupRepository {
  const { driver, errorLog } = deps;
  const fail = storageFailureOf(errorLog);
  return {
    readAll: () =>
      attempt(() => {
        const lists = readableRows(LISTS, driver.all(SELECT_LISTS_SQL, []), errorLog);
        const tasks = withParent(
          {
            table: 'tasks',
            parentOf: (task) => task.list_id,
            parentIds: new Set(lists.rows.map((list) => list.id)),
          },
          readableRows(TASKS, driver.all(SELECT_TASKS_SQL, []), errorLog),
          errorLog,
        );
        const payload = { lists: lists.rows, tasks: tasks.rows };
        return { payload, skippedRows: lists.skipped + tasks.skipped };
      }, fail),
    replaceAll: (input) => {
      const parsed = v.safeParse(BACKUP_PAYLOAD, input);
      if (!parsed.success) {
        return err({ kind: 'invalid-input', path: v.getDotPath(parsed.issues[0]) ?? '(payload)' });
      }
      // ONE transaction: children cleared before parents, then every row inserted. A failure on
      // any row rolls every statement back, so the old rows are all still there.
      const written = attempt(() => {
        driver.transaction(() => {
          driver.run(DELETE_TASKS_SQL, []);
          driver.run(DELETE_LISTS_SQL, []);
          insertRows(driver, parsed.output);
        });
      }, fail);
      if (!written.ok) return err({ kind: 'storage', failure: written.error });
      return ok({ lists: parsed.output.lists.length, tasks: parsed.output.tasks.length });
    },
  };
}
