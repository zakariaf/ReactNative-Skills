// src/features/tasks/tasks-digest.ts
export const digestNotificationId = (listId: string, dateKey: string): string => `digest:${listId}:${dateKey}`;
