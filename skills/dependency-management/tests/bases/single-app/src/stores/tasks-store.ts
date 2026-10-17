// src/stores/tasks-store.ts (fixture)
import { create } from 'zustand';

export const useTasksStore = create(() => ({ tasks: [] as string[] }));
