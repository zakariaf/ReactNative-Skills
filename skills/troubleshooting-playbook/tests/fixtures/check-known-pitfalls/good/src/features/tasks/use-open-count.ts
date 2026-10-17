// src/features/tasks/use-open-count.ts
import { useShallow } from 'zustand/shallow';

import { useTasksStore } from '@/stores/tasks-store';

export function useOpenTasks() {
  return useTasksStore(useShallow((state) => state.tasks.filter((task) => !task.isDone)));
}
