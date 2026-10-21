// src/features/tasks/use-tasks-model.ts: the task list's model; it reaches the synced store only through its port.
import { useEffect, useState } from 'react';

import type { Task, TaskStorePort } from '@/data/tasks/task-store-port';

export function useTasksModel(store: TaskStorePort, listId: string): readonly Task[] {
  const [tasks, setTasks] = useState<readonly Task[]>([]);
  useEffect(() => store.watchList(listId, setTasks), [store, listId]);
  return tasks;
}
