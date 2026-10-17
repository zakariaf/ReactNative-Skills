// src/features/tasks/complete-task.ts
export type Task = { readonly id: string; readonly isDone: boolean };

export function completeTask(task: Task, onSaved: (next: Task) => void): void {
  onSaved({ ...task, isDone: true });
}
