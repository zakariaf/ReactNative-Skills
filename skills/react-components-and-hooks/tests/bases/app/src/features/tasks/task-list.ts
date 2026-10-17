// src/features/tasks/task-list.ts: pure logic, tested without React.
import type { Task } from '@/stores/tasks-store';

export function visibleTasks(tasks: readonly Task[], filter: 'all' | 'open'): readonly Task[] {
  const shown = filter === 'open' ? tasks.filter((task) => !task.isDone) : tasks;
  return [...shown].sort((a, b) => Number(a.isDone) - Number(b.isDone));
}
