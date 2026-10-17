// src/features/tasks/use-tasks-model.ts: the only code of the feature that reads state.
import { useState } from 'react';

import { sortTasks } from './task-list';

import type { Task } from './task-list';

export type TasksModel = {
  readonly tasks: readonly Task[];
  readonly addTask: () => void;
  readonly toggleTask: (taskId: string) => void;
};

export function useTasksModel(): TasksModel {
  const [tasks, setTasks] = useState<readonly Task[]>([]);
  const addTask = (): void => {
    setTasks((current) => [...current, { id: `task-${String(current.length + 1)}`, title: '', isDone: false }]);
  };
  const toggleTask = (taskId: string): void => {
    setTasks((current) => current.map((task) => (task.id === taskId ? { ...task, isDone: !task.isDone } : task)));
  };
  return { tasks: sortTasks(tasks), addTask, toggleTask };
}
