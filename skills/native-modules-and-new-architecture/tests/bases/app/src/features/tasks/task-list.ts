// src/features/tasks/task-list.ts
export type Task = { readonly id: string; readonly title: string; readonly isDone: boolean };

export function openTasks(tasks: readonly Task[]): readonly Task[] {
  return tasks.filter((task) => !task.isDone);
}
