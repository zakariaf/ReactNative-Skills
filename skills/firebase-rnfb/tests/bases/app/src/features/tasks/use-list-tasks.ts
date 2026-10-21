// src/features/tasks/use-list-tasks.ts: the list screen's model reads tasks only through the port.
import { useEffect, useState } from 'react';

import type { Task, TaskStorePort } from '@/data/tasks/task-store-port';

export function useListTasks(store: TaskStorePort, listId: string): readonly Task[] {
  const [tasks, setTasks] = useState<readonly Task[]>([]);
  useEffect(() => store.watchList(listId, { onTasks: setTasks, onError: () => undefined }), [store, listId]);
  return tasks;
}

export function useAddTask(store: TaskStorePort): (listId: string, title: string) => boolean {
  return (listId, title) => store.addTask({ listId, title }).ok;
}
