// src/features/tasks/task-sync-types.ts
// The kind grammar on a sync log: commands are imperative requests, events are past-tense facts,
// errors are noun phrases. Event kinds are stored (the local outbox, exported backups): renaming
// one is a data migration, never a refactor.
export type TaskCommand =
  | { readonly kind: 'create-task'; readonly listId: string; readonly title: string }
  | { readonly kind: 'complete-task'; readonly taskId: string }
  | { readonly kind: 'move-task'; readonly taskId: string; readonly toListId: string }
  | { readonly kind: 'schedule-reminder'; readonly taskId: string; readonly atMs: number };

export type TaskEvent =
  | { readonly kind: 'task-created'; readonly taskId: string; readonly listId: string }
  | { readonly kind: 'task-completed'; readonly taskId: string; readonly completedAtMs: number }
  | { readonly kind: 'task-moved'; readonly taskId: string; readonly fromListId: string; readonly toListId: string }
  | { readonly kind: 'reminder-scheduled'; readonly taskId: string; readonly atMs: number };

/** What went wrong, as a noun phrase. */
export type TaskSyncError =
  | { readonly kind: 'stale-revision'; readonly serverRevision: number }
  | { readonly kind: 'list-not-found'; readonly listId: string }
  | { readonly kind: 'quota-exceeded' };

/** The result a sync step returns: the events it produced, or one error. */
export type TaskSyncResult =
  | { readonly kind: 'applied'; readonly events: readonly TaskEvent[] }
  | { readonly kind: 'rejected'; readonly error: TaskSyncError };
