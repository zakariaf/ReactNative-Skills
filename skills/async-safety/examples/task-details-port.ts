// src/services/task-details/task-details-port.ts (example: a shape to imitate, never copied)
// A port over on-device work whose calls can be cancelled: here the app's SQLite tasks repository
// (expo-sqlite) and its full-text search. Every async member takes the caller's AbortSignal; work
// that accepts one (a native SDK call) receives it, and work that cannot stop (a SQLite query)
// checks `signal.aborted` after its await, so the adapter maps a call that ran after an abort to
// `cancelled`, decided by the signal, never by the shape of the error. This is not how server data
// is read: data behind the ApiClient goes through useQuery (networking-and-server-state), whose
// query keys already give latest-wins and whose queryFn receives TanStack's signal.
import type { Result } from '@/core/result';

export type TaskDetails = {
  readonly id: string;
  readonly title: string;
  readonly notes: string;
  readonly isDone: boolean;
};

export type TaskDetailsFailure =
  | { readonly kind: 'not-found'; readonly taskId: string }
  | { readonly kind: 'timed-out'; readonly afterMs: number }
  | { readonly kind: 'cancelled' };

/** Loads and searches the tasks stored on the device; every call stops early when its signal aborts. */
export type TaskDetailsPort = {
  /** Resolves with the task, or a failure; never rejects. */
  readonly load: (
    taskId: string,
    signal: AbortSignal,
  ) => Promise<Result<TaskDetails, TaskDetailsFailure>>;
  /** Resolves with the matching titles, newest first, or a failure; never rejects. */
  readonly search: (
    query: string,
    signal: AbortSignal,
  ) => Promise<Result<readonly TaskDetails[], TaskDetailsFailure>>;
};
