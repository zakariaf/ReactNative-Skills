// src/features/tasks/tasks-digest.ts
export interface DigestTask {
  readonly id: string;
  readonly title: string;
  readonly isDone: boolean;
  readonly dueKey: string | null;
}

/** The scheduled digest notification of a list on a date: installed versions cancel by this id. */
export function digestNotificationId(listId: string, dateKey: string): string {
  return `digest:${listId}:${dateKey}`;
}
