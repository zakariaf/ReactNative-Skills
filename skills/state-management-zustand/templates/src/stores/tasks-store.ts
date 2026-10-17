// src/stores/tasks-store.ts: the tasks store: thin, hydrated once, every change saved before it is shown.
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { ok } from '@/core/result';
import { useStores } from '@/stores/stores-context';
import { DEFAULT_TASKS_STATE, tasksReducer } from '@/stores/tasks-reducer';

import type { Result } from '@/core/result';
import type { Task, TaskFailure, TaskRepository } from '@/data/tasks/task-repository';
import type { TasksAction, TasksState } from '@/stores/tasks-reducer';
import type { StoreApi } from 'zustand/vanilla';

export type TasksStoreState = TasksState & {
  /** Saves a new task, then shows it. A failed write shows nothing and comes back as a value. */
  readonly addTask: (listId: number, title: string) => Result<Task, TaskFailure>;
  /** Saves the done flag, then shows it; a change that changes nothing writes nothing. */
  readonly setDone: (taskId: number, isDone: boolean) => Result<void, TaskFailure>;
  /** Re-reads every task from disk (updateAndPublish calls it after a write that spans stores). */
  readonly reload: () => void;
};

export type TasksStore = StoreApi<TasksStoreState>;

/** What the tasks store reads and writes through: the Tasks repository (AppData's `tasks`). */
export type TasksStoreDeps = {
  readonly tasks: Pick<TaskRepository, 'lists' | 'tasksOf' | 'addTask' | 'setDone'>;
};

/** Every task of every list as a reducer action, or the first read that failed. */
function readTasks(tasks: TasksStoreDeps['tasks']): TasksAction {
  const lists = tasks.lists();
  if (!lists.ok) return { type: 'record-load-failure', failure: lists.error };
  const all: Task[] = [];
  for (const list of lists.value) {
    const ofList = tasks.tasksOf(list.id);
    if (!ofList.ok) return { type: 'record-load-failure', failure: ofList.error };
    all.push(...ofList.value);
  }
  return { type: 'replace-tasks', tasks: all };
}

/** One store per app start: createStores calls it, never module code. */
export function createTasksStore({ tasks }: TasksStoreDeps): TasksStore {
  return createStore<TasksStoreState>()((set, get) => ({
    ...tasksReducer(DEFAULT_TASKS_STATE, readTasks(tasks)),
    addTask: (listId, title) => {
      const saved = tasks.addTask({ listId, title });
      if (!saved.ok) return saved;
      set(tasksReducer(get(), { type: 'add-task', task: saved.value }));
      return saved;
    },
    setDone: (taskId, isDone) => {
      // 1. Reduce: a refused or no-op change returns the same object and stops here.
      const current = get();
      const next = tasksReducer(current, { type: 'set-done', taskId, isDone });
      if (next === current) return ok(undefined);
      // 2. Persist: committed when it returns ok; a failed write publishes nothing.
      const saved = tasks.setDone(taskId, isDone);
      if (!saved.ok) return saved;
      // 3. Publish.
      set(next);
      return saved;
    },
    reload: () => {
      const action = readTasks(tasks);
      set(tasksReducer(get(), action));
    },
  }));
}

/** Always with a selector: a primitive or a state reference, or a built value through useShallow. */
export function useTasksStore<TSlice>(selector: (state: TasksStoreState) => TSlice): TSlice {
  return useStore(useStores().tasks, selector);
}
