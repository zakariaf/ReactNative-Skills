import { isTaskDone } from '@/core/tasks/task';

import type { Task } from '@/core/tasks/task';

export function openTasks(tasks: readonly Task[]): readonly Task[] {
  return tasks.filter((task) => !isTaskDone(task));
}
