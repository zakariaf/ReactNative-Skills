// src/data/tasks/task-store-port.ts
// The synced task store as features and stores see it. Writes return as soon as the change is in the
// device's offline cache (they never wait for the server); a write the server later refuses arrives
// through the adapter's onWriteRejected. Reads are live: watchList calls back on every change and
// returns the unsubscribe the caller's effect hands back to React.
import type { Result } from '@/core/result';

export type Task = {
  readonly id: string;
  readonly listId: string;
  readonly title: string;
  readonly isDone: boolean;
  /** When the server stored the last change; an estimate while the write is still pending. */
  readonly updatedAtMs: number | null;
};

export type TaskDraft = { readonly listId: string; readonly title: string };

export type TaskStoreFailure = {
  readonly kind: 'invalid-task';
  readonly field: 'listId' | 'title';
};

export type TaskWatchFailure = { readonly kind: 'watch-failed'; readonly code: string };

/** A write the server refused after it left the cache (permission-denied, a rules check). */
export type TaskWriteRejection = {
  readonly kind: 'write-rejected';
  readonly taskId: string;
  readonly code: string;
};

export type TaskListListener = {
  readonly onTasks: (tasks: readonly Task[]) => void;
  readonly onError: (failure: TaskWatchFailure) => void;
};

export type Unsubscribe = () => void;

export type TaskStorePort = {
  /** Adds a task to a list in one batched write; the new id is known at once, offline too. */
  readonly addTask: (draft: TaskDraft) => Result<{ readonly id: string }, TaskStoreFailure>;
  /** Marks a task done or open, and moves the list's open count, in one batched write. */
  readonly setDone: (task: Pick<Task, 'id' | 'listId'>, isDone: boolean) => void;
  readonly watchList: (listId: string, listener: TaskListListener) => Unsubscribe;
};
