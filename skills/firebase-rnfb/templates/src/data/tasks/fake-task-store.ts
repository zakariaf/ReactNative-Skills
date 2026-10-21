// src/data/tasks/fake-task-store.ts
// Jest only: a TaskStorePort in memory, so feature tests run without Firebase. Writes call every
// watcher of the list at once, like the offline cache does; rejectNextWrite plays a server refusal.
import { err, ok } from '@/core/result';

import type {
  Task,
  TaskDraft,
  TaskListListener,
  TaskStorePort,
  TaskWriteRejection,
} from '@/data/tasks/task-store-port';

export type FakeTaskStore = TaskStorePort & {
  readonly tasks: () => readonly Task[];
  /** How many watchers are subscribed right now: proves that an effect unsubscribed. */
  readonly watcherCount: () => number;
  readonly rejections: () => readonly TaskWriteRejection[];
  readonly rejectNextWrite: (code: string) => void;
};

type FakeState = {
  /** Mutated in place (push, splice), never reassigned. */
  readonly tasks: Task[];
  readonly pendingRejections: string[];
  readonly watchers: Set<{ readonly listId: string; readonly listener: TaskListListener }>;
  readonly rejections: TaskWriteRejection[];
};

function publish(state: FakeState, listId: string): void {
  for (const watcher of state.watchers) {
    if (watcher.listId === listId) {
      watcher.listener.onTasks(state.tasks.filter((task) => task.listId === listId));
    }
  }
}

/** Plays the server's answer: a planned rejection arrives once, for this write. */
function settle(state: FakeState, taskId: string): void {
  const code = state.pendingRejections.shift();
  if (code !== undefined) {
    state.rejections.push({ kind: 'write-rejected', taskId, code });
  }
}

function addTask(state: FakeState, draft: TaskDraft): ReturnType<TaskStorePort['addTask']> {
  const title = draft.title.trim();
  if (draft.listId === '') {
    return err({ kind: 'invalid-task', field: 'listId' });
  }
  if (title === '') {
    return err({ kind: 'invalid-task', field: 'title' });
  }
  const id = `task-${String(state.tasks.length + 1)}`;
  state.tasks.push({ id, listId: draft.listId, title, isDone: false, updatedAtMs: null });
  publish(state, draft.listId);
  settle(state, id);
  return ok({ id });
}

function setDone(state: FakeState, task: Pick<Task, 'id' | 'listId'>, isDone: boolean): void {
  const index = state.tasks.findIndex((entry) => entry.id === task.id);
  const current = state.tasks[index];
  if (current !== undefined) {
    state.tasks.splice(index, 1, { ...current, isDone });
  }
  publish(state, task.listId);
  settle(state, task.id);
}

function watchList(state: FakeState, listId: string, listener: TaskListListener): () => void {
  const watcher = { listId, listener };
  state.watchers.add(watcher);
  listener.onTasks(state.tasks.filter((task) => task.listId === listId));
  return () => {
    state.watchers.delete(watcher);
  };
}

export function createFakeTaskStore(seed: readonly Task[] = []): FakeTaskStore {
  const state: FakeState = {
    tasks: [...seed],
    pendingRejections: [],
    watchers: new Set(),
    rejections: [],
  };
  return {
    addTask: (draft) => addTask(state, draft),
    setDone: (task, isDone) => {
      setDone(state, task, isDone);
    },
    watchList: (listId, listener) => watchList(state, listId, listener),
    tasks: () => [...state.tasks],
    watcherCount: () => state.watchers.size,
    rejections: () => [...state.rejections],
    rejectNextWrite: (code) => {
      state.pendingRejections.push(code);
    },
  };
}
