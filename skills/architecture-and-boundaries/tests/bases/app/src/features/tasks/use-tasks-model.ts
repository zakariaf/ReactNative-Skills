import { useServices } from '@/services/services-context';
import { selectOpenTasks } from '@/stores/tasks-selectors';

import type { Task } from '@/core/tasks/task';
import type { TasksState } from '@/stores/tasks-store';

const EMPTY: TasksState = { tasks: [] };

export function useTasksModel(): { readonly tasks: readonly Task[]; readonly today: string } {
  const { clock } = useServices();
  return { tasks: selectOpenTasks(EMPTY), today: clock.today() };
}
