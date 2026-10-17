// src/features/tasks/task-list.ts
export interface Task {
  readonly id: string;
  readonly isDone: boolean;
}

/** Open tasks first, keeping their order. */
export function sortOpenFirst(tasks: readonly Task[]): readonly Task[] {
  return [...tasks.filter((task) => !task.isDone), ...tasks.filter((task) => task.isDone)];
}
