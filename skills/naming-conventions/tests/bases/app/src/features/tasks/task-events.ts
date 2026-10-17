// src/features/tasks/task-events.ts: the kind grammar. Commands are imperative, events past tense,
// errors a noun phrase. Event kinds are saved in the sync log: renaming one needs a migration.
export type TaskCommand =
  | { readonly kind: 'complete-task'; readonly taskId: string }
  | { readonly kind: 'rename-task'; readonly taskId: string; readonly title: string };

export type TaskEvent =
  | { readonly kind: 'task-completed'; readonly taskId: string }
  | { readonly kind: 'task-renamed'; readonly taskId: string; readonly title: string };

export type TaskSyncError = { readonly kind: 'stale-revision' | 'list-not-found' };
