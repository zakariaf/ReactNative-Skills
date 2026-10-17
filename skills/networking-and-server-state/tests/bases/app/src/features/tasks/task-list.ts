// src/features/tasks/task-list.ts: pure task-list logic (no React, no I/O).

/** One task as the list shows it. */
export type Task = {
  readonly id: string;
  readonly title: string;
  readonly isDone: boolean;
};

/** Open tasks first, then done ones, each group by title. */
export function sortTasks(tasks: readonly Task[], locale: string): readonly Task[] {
  return [...tasks].sort((first, second) =>
    first.isDone === second.isDone ? first.title.localeCompare(second.title, locale) : first.isDone ? 1 : -1,
  );
}

/** How many tasks are still open. */
export function countOpen(tasks: readonly Task[]): number {
  return tasks.filter((task) => !task.isDone).length;
}
