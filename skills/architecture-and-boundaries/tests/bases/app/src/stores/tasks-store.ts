import { createStore } from 'zustand/vanilla';

import type { Task } from '@/core/tasks/task';

export type TasksState = { readonly tasks: readonly Task[] };

/** One store per domain, made by a factory the composition root calls once. */
export function createTasksStore() {
  return createStore<TasksState>(() => ({ tasks: [] }));
}
