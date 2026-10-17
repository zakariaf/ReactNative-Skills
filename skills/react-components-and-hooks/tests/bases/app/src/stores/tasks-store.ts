// src/stores/tasks-store.ts: a store file may export its own hook.
import { create } from 'zustand';

export type Task = { readonly id: string; readonly title: string; readonly isDone: boolean };

export type TasksState = {
  readonly tasks: readonly Task[];
  readonly filter: 'all' | 'open';
  readonly isPremium: boolean;
};

export const useTasksStore = create<TasksState>()(() => ({ tasks: [], filter: 'all', isPremium: false }));
