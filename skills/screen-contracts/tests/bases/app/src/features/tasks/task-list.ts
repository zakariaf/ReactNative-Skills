// src/features/tasks/task-list.ts: pure task-list logic (no React, no I/O).

/** One task as the list shows it. */
export type Task = {
  readonly id: string;
  readonly title: string;
  readonly isDone: boolean;
};

/**
 * Open tasks first, then done ones; each group in the title order of `locale` (the UI language, so
 * Arabic titles sort the Arabic way). Never changes `tasks`.
 */
export function sortTasks(tasks: readonly Task[], locale: string): readonly Task[] {
  return [...tasks].sort((first, second) => {
    if (first.isDone !== second.isDone) {
      return first.isDone ? 1 : -1;
    }
    return first.title.localeCompare(second.title, locale);
  });
}

/** How many tasks are still open. */
export function countOpen(tasks: readonly Task[]): number {
  return tasks.filter((task) => !task.isDone).length;
}

/** The list with task `id` flipped between open and done; the same list when no task has that id. */
export function toggleTask(tasks: readonly Task[], id: string): readonly Task[] {
  return tasks.map((task) => (task.id === id ? { ...task, isDone: !task.isDone } : task));
}
