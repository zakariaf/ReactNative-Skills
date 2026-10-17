// Pure domain: no React, React Native or Expo imports.
export type Task = { readonly id: string; readonly title: string; readonly done: boolean };

export function isTaskDone(task: Pick<Task, 'done'>): boolean {
  return task.done;
}
