// src/data/tasks/sqlite-task-repository.ts: the Tasks repository on SQL, the only code that reads or writes lists and tasks.
import * as v from 'valibot';

import { attempt, err, ok } from '@/core/result';
import { invalidInput, taskFailureOf } from '@/data/tasks/task-failures';
import {
  LIST_ID,
  LIST_ROW,
  NEW_LIST,
  NEW_TASK,
  TASK_DONE,
  TASK_ROW,
} from '@/data/tasks/task-schema';

import type { SqlDriver, SqlRow } from '@/data/sql-driver';
import type { Task, TaskList, TaskRepository } from '@/data/tasks/task-repository';
import type { ListRow, TaskRow } from '@/data/tasks/task-schema';
import type { ClockPort } from '@/services/clock/clock-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

const SELECT_LISTS_SQL = 'SELECT id, name, created_at_ms FROM lists ORDER BY name, id';
const SELECT_TASKS_SQL =
  'SELECT id, list_id, title, is_done, created_at_ms FROM tasks WHERE list_id = ? ORDER BY id';
const INSERT_LIST_SQL = 'INSERT INTO lists (name, created_at_ms) VALUES (?, ?)';
const INSERT_TASK_SQL =
  'INSERT INTO tasks (list_id, title, is_done, created_at_ms) VALUES (?, ?, 0, ?)';
const SET_DONE_SQL = 'UPDATE tasks SET is_done = ? WHERE id = ?';
const DELETE_TASKS_OF_LIST_SQL = 'DELETE FROM tasks WHERE list_id = ?';
const DELETE_LIST_SQL = 'DELETE FROM lists WHERE id = ?';

export type SqliteTaskRepositoryDeps = {
  readonly driver: SqlDriver;
  readonly clock: Pick<ClockPort, 'nowMs'>;
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
};

type RowReader<TSchema extends v.GenericSchema, TItem> = {
  readonly table: string;
  readonly schema: TSchema;
  readonly toItem: (row: v.InferOutput<TSchema>) => TItem;
};

const LISTS: RowReader<typeof LIST_ROW, TaskList> = {
  table: 'lists',
  schema: LIST_ROW,
  toItem: (row: ListRow) => ({ id: row.id, name: row.name, createdAtMs: row.created_at_ms }),
};

const TASKS: RowReader<typeof TASK_ROW, Task> = {
  table: 'tasks',
  schema: TASK_ROW,
  toItem: (row: TaskRow) => ({
    id: row.id,
    listId: row.list_id,
    title: row.title,
    isDone: row.is_done === 1,
    createdAtMs: row.created_at_ms,
  }),
};

/** Every row goes through its schema. An unreadable row is skipped and logged alone, never a crash. */
function readableRows<TSchema extends v.GenericSchema, TItem>(
  reader: RowReader<TSchema, TItem>,
  rows: readonly SqlRow[],
  errorLog: Pick<ErrorLogPort, 'record'>,
): readonly TItem[] {
  const items: TItem[] = [];
  for (const row of rows) {
    const result = v.safeParse(reader.schema, row);
    if (result.success) {
      items.push(reader.toItem(result.output));
    } else {
      const path = v.getDotPath(result.issues[0]) ?? '(row)';
      errorLog.record('storage', new Error(`unreadable ${reader.table} row: ${path}`));
    }
  }
  return items;
}

function readMethods(deps: SqliteTaskRepositoryDeps): Pick<TaskRepository, 'lists' | 'tasksOf'> {
  const { driver, errorLog } = deps;
  const fail = taskFailureOf(errorLog);
  return {
    lists: () =>
      attempt(() => readableRows(LISTS, driver.all(SELECT_LISTS_SQL, []), errorLog), fail),
    tasksOf: (listId) =>
      attempt(() => readableRows(TASKS, driver.all(SELECT_TASKS_SQL, [listId]), errorLog), fail),
  };
}

function listWrites(
  deps: SqliteTaskRepositoryDeps,
): Pick<TaskRepository, 'addList' | 'removeList'> {
  const { driver, clock, errorLog } = deps;
  return {
    addList: (input) => {
      const parsed = v.safeParse(NEW_LIST, input);
      if (!parsed.success) return err(invalidInput(parsed.issues));
      const { name } = parsed.output;
      const createdAtMs = clock.nowMs();
      return attempt(() => {
        const { lastInsertRowId } = driver.run(INSERT_LIST_SQL, [name, createdAtMs]);
        return { id: lastInsertRowId, name, createdAtMs };
      }, taskFailureOf(errorLog));
    },
    removeList: (listId) => {
      const parsed = v.safeParse(LIST_ID, listId);
      if (!parsed.success) return err(invalidInput(parsed.issues));
      const id = parsed.output;
      const removed = attempt(() => {
        let changes = 0;
        driver.transaction(() => {
          driver.run(DELETE_TASKS_OF_LIST_SQL, [id]);
          changes = driver.run(DELETE_LIST_SQL, [id]).changes;
        });
        return changes;
      }, taskFailureOf(errorLog));
      if (!removed.ok) return removed;
      return removed.value === 0 ? err({ kind: 'list-not-found', listId: id }) : ok(undefined);
    },
  };
}

function taskWrites(deps: SqliteTaskRepositoryDeps): Pick<TaskRepository, 'addTask' | 'setDone'> {
  const { driver, clock, errorLog } = deps;
  return {
    addTask: (input) => {
      const parsed = v.safeParse(NEW_TASK, input);
      if (!parsed.success) return err(invalidInput(parsed.issues));
      const { listId, title } = parsed.output;
      const createdAtMs = clock.nowMs();
      return attempt(
        () => {
          const { lastInsertRowId } = driver.run(INSERT_TASK_SQL, [listId, title, createdAtMs]);
          return { id: lastInsertRowId, listId, title, isDone: false, createdAtMs };
        },
        taskFailureOf(errorLog, { listId }),
      );
    },
    setDone: (taskId, isDone) => {
      const parsed = v.safeParse(TASK_DONE, { taskId, isDone });
      if (!parsed.success) return err(invalidInput(parsed.issues));
      const change = parsed.output;
      const updated = attempt(
        () => driver.run(SET_DONE_SQL, [change.isDone ? 1 : 0, change.taskId]).changes,
        taskFailureOf(errorLog),
      );
      if (!updated.ok) return updated;
      return updated.value === 0
        ? err({ kind: 'task-not-found', taskId: change.taskId })
        : ok(undefined);
    },
  };
}

/** One object of methods; each converts its own failures once (task-failures.ts). */
export function createSqliteTaskRepository(deps: SqliteTaskRepositoryDeps): TaskRepository {
  return { ...readMethods(deps), ...listWrites(deps), ...taskWrites(deps) };
}
