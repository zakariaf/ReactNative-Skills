// src/data/tasks/fake-task-repository.ts: an in-memory TaskRepository for screen, hook and store tests.
import * as v from 'valibot';

import { err, ok } from '@/core/result';
import { invalidInput } from '@/data/tasks/task-failures';
import { LIST_ID, NEW_LIST, NEW_TASK, TASK_DONE } from '@/data/tasks/task-schema';

import type { Result } from '@/core/result';
import type { Task, TaskFailure, TaskList, TaskRepository } from '@/data/tasks/task-repository';
import type { ClockPort } from '@/services/clock/clock-port';

/** The same validation and failures as the SQLite adapter, so a test cannot pass what the app refuses. */
export type FakeTaskRepository = TaskRepository & {
  /** The next write returns this failure once, before anything changes (a full disk, a lock). */
  failNextWrite: TaskFailure | null;
};

type FakeTables = {
  readonly lists: Map<number, TaskList>;
  readonly tasks: Map<number, Task>;
  readonly nextId: () => number;
  readonly nowMs: () => number;
  /** The planned failure of this write, if any (and clears it). */
  readonly takeFailure: () => TaskFailure | null;
};

function byNameThenId(first: TaskList, second: TaskList): number {
  const byName = first.name.localeCompare(second.name);
  return byName === 0 ? first.id - second.id : byName;
}

/** Runs `write` unless the input is invalid or a failure was planned: the adapter's order. */
function guarded<TInput, TValue>(
  tables: FakeTables,
  input: v.SafeParseResult<v.GenericSchema<unknown, TInput>>,
  write: (value: TInput) => Result<TValue, TaskFailure>,
): Result<TValue, TaskFailure> {
  if (!input.success) return err(invalidInput(input.issues));
  const planned = tables.takeFailure();
  return planned === null ? write(input.output) : err(planned);
}

function writeMethods(tables: FakeTables): Omit<TaskRepository, 'lists' | 'tasksOf'> {
  const { lists, tasks } = tables;
  return {
    addList: (input) =>
      guarded(tables, v.safeParse(NEW_LIST, input), ({ name }) => {
        const list = { id: tables.nextId(), name, createdAtMs: tables.nowMs() };
        lists.set(list.id, list);
        return ok(list);
      }),
    addTask: (input) =>
      guarded(tables, v.safeParse(NEW_TASK, input), ({ listId, title }) => {
        if (!lists.has(listId)) return err({ kind: 'list-not-found', listId });
        const createdAtMs = tables.nowMs();
        const task = { id: tables.nextId(), listId, title, isDone: false, createdAtMs };
        tasks.set(task.id, task);
        return ok(task);
      }),
    setDone: (taskId, isDone) =>
      guarded(tables, v.safeParse(TASK_DONE, { taskId, isDone }), (change) => {
        const task = tasks.get(change.taskId);
        if (task === undefined) return err({ kind: 'task-not-found', taskId: change.taskId });
        tasks.set(task.id, { ...task, isDone: change.isDone });
        return ok(undefined);
      }),
    removeList: (listId) =>
      guarded(tables, v.safeParse(LIST_ID, listId), (id) => {
        if (!lists.has(id)) return err({ kind: 'list-not-found', listId: id });
        for (const task of tasks.values()) if (task.listId === id) tasks.delete(task.id);
        lists.delete(id);
        return ok(undefined);
      }),
  };
}

export function createFakeTaskRepository(
  clock: Pick<ClockPort, 'nowMs'> = { nowMs: () => 0 },
): FakeTaskRepository {
  let lastId = 0;
  const tables: FakeTables = {
    lists: new Map(),
    tasks: new Map(),
    nextId: () => {
      lastId += 1;
      return lastId;
    },
    nowMs: clock.nowMs,
    takeFailure: () => {
      const planned = fake.failNextWrite;
      fake.failNextWrite = null;
      return planned;
    },
  };
  const fake: FakeTaskRepository = {
    failNextWrite: null,
    lists: () => ok([...tables.lists.values()].sort(byNameThenId)),
    tasksOf: (listId) => ok([...tables.tasks.values()].filter((task) => task.listId === listId)),
    ...writeMethods(tables),
  };
  return fake;
}
