// src/features/tasks/task-list.ts: pure task-list logic (no React, no I/O).

/** Titles longer than this are cut when shown in a row. */
export const MAX_TITLE_LENGTH = 120;

export const TASK_PRIORITIES = ['low', 'normal', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type Task = {
  readonly id: string;
  readonly title: string;
  readonly isDone: boolean;
};

/** Open tasks first, then done ones; each group keeps its order by title. */
export function sortTasks(tasks: readonly Task[]): readonly Task[] {
  return [...tasks].sort((first, second) => {
    if (first.isDone !== second.isDone) {
      return first.isDone ? 1 : -1;
    }
    return first.title.localeCompare(second.title);
  });
}

export function countOpen(tasks: readonly Task[], isIncludingDone: boolean): number {
  return isIncludingDone ? tasks.length : tasks.filter((task) => !task.isDone).length;
}
