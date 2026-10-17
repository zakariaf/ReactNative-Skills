import { isTaskDone } from '@/core/tasks/task';

import type { Task } from '@/core/tasks/task';
import type { TasksState } from '@/stores/tasks-store';

export function selectOpenTasks(state: TasksState): readonly Task[] {
  return state.tasks.filter((task) => !isTaskDone(task));
}
