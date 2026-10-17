// src/data/tasks/task-repository.ts (example: a shape to imitate, never copied)
// A boundary: the only code that talks to SQLite for tasks. Every throw from the driver is converted
// here, once, into a TaskFailure; nothing above this file ever sees an SQLite error. Unexpected
// failures are recorded with the raw error before the typed failure is returned. Expected ones
// (a duplicate title) are not: they are the user's input, not a defect. Only the UNIQUE index on
// tasks.title is the user's input; any other clash (a reused id) is a bug, so it is recorded.
import { attempt, err, ok } from '@/core/result';
import { toStorageFailure } from '@/data/to-storage-failure';

import type { Result } from '@/core/result';
import type { Task } from '@/core/tasks/task';
import type { TaskFailure } from '@/core/tasks/task-failure';
import type { SqlDriver } from '@/data/sql-driver';
import type { StorageFailure } from '@/data/to-storage-failure';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

export type TaskDraft = { readonly id: string; readonly title: string };

/** Task storage. Every method returns a Result and never throws for a storage failure. */
export type TaskRepository = {
  readonly add: (draft: TaskDraft) => Result<Task, TaskFailure>;
  /** Renames a stored task; ok carries nothing, so no caller trusts a task this code did not read. */
  readonly rename: (taskId: string, title: string) => Result<void, TaskFailure>;
};

export type TaskRepositoryDeps = {
  readonly driver: SqlDriver;
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
};

const INSERT_TASK = 'INSERT INTO tasks (id, title, is_done) VALUES (?, ?, 0)';
const RENAME_TASK = 'UPDATE tasks SET title = ? WHERE id = ?';

const SQLITE_CORRUPT = 11;
const SQLITE_CONSTRAINT = 19;
/** The one constraint a person can trip by typing: two tasks with the same title. */
const TITLE_COLUMN = 'tasks.title';

const unavailable = (code: number | null): TaskFailure => ({ kind: 'storage-unavailable', code });

/** The title as stored: trimmed, and never empty (the same rule for add and rename). */
function cleanTitle(raw: string): Result<string, TaskFailure> {
  const title = raw.trim();
  return title === '' ? err({ kind: 'task-title-empty' }) : ok(title);
}

/** Names a storage failure in the task domain; total, like every mapper. */
function toTaskFailure(storage: StorageFailure, title: string): TaskFailure {
  switch (storage.kind) {
    case 'constraint':
      return storage.detail === 'unique' && storage.columns.join(', ') === TITLE_COLUMN
        ? { kind: 'task-title-taken', title }
        : unavailable(SQLITE_CONSTRAINT);
    case 'full':
      return { kind: 'storage-full' };
    case 'busy':
      return { kind: 'storage-busy' };
    case 'corrupt':
      return unavailable(SQLITE_CORRUPT);
    case 'unknown':
      return unavailable(storage.code);
  }
}

export function createTaskRepository({ driver, errorLog }: TaskRepositoryDeps): TaskRepository {
  const failWith =
    (title: string) =>
    (thrown: unknown): TaskFailure => {
      const failure = toTaskFailure(toStorageFailure(thrown), title);
      // Record first, with the original error: past this line only the typed failure exists.
      if (failure.kind === 'storage-unavailable') errorLog.record('storage', thrown);
      return failure;
    };
  return {
    add: (draft) => {
      const title = cleanTitle(draft.title);
      if (!title.ok) return title;
      const task: Task = { id: draft.id, title: title.value, isDone: false };
      return attempt(() => {
        driver.run(INSERT_TASK, [task.id, task.title]);
        return task;
      }, failWith(task.title));
    },
    rename: (taskId, rawTitle) => {
      const title = cleanTitle(rawTitle);
      if (!title.ok) return title;
      const changed = attempt(
        () => driver.run(RENAME_TASK, [title.value, taskId]),
        failWith(title.value),
      );
      if (!changed.ok) return changed;
      return changed.value.changes === 0 ? err({ kind: 'task-not-found', taskId }) : ok(undefined);
    },
  };
}
