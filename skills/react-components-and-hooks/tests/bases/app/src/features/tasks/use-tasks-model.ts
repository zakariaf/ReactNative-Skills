// src/features/tasks/use-tasks-model.ts: the only code of the feature that reads stores.
import { useShallow } from 'zustand/shallow';

import { useTasksStore } from '@/stores/tasks-store';

import { visibleTasks } from './task-list';

import type { Task } from '@/stores/tasks-store';

export type TasksModel = {
  readonly tasks: readonly Task[];
  readonly isPremium: boolean;
  readonly onToggle: (id: string) => void;
};

export function useTasksModel(): TasksModel {
  const filter = useTasksStore((state) => state.filter);
  const { tasks, isPremium } = useTasksStore(
    useShallow((state) => ({ tasks: state.tasks, isPremium: state.isPremium })),
  );
  return {
    tasks: visibleTasks(tasks, filter),
    isPremium,
    onToggle: (id) => {
      useTasksStore.setState((state) => ({
        tasks: state.tasks.map((task) => (task.id === id ? { ...task, isDone: !task.isDone } : task)),
      }));
    },
  };
}
