// src/data/tasks/task-repository.ts: the Tasks repository port: everything features may ask of lists and tasks.
import type { Result } from '@/core/result';
import type { NewList, NewTask } from '@/data/tasks/task-schema';

export type TaskList = {
  readonly id: number;
  readonly name: string;
  readonly createdAtMs: number;
};

export type Task = {
  readonly id: number;
  readonly listId: number;
  readonly title: string;
  readonly isDone: boolean;
  readonly createdAtMs: number;
};

/** Why a Tasks call failed in a way the app expects and handles (error-handling-typed-results). */
export type TaskFailure =
  /** The input failed its schema; nothing was written. `field` is the first failing path. */
  | { readonly kind: 'task-input-invalid'; readonly field: string }
  | { readonly kind: 'list-not-found'; readonly listId: number }
  | { readonly kind: 'task-not-found'; readonly taskId: number }
  | { readonly kind: 'storage-full' }
  | { readonly kind: 'storage-busy' }
  /** A damaged file, an I/O error or a bug: the raw error is already in the error log. */
  | { readonly kind: 'storage-unavailable'; readonly code: number | null };

/** The kinds as data, for exhaustiveness tests (every kind has a message in every locale). */
export const TASK_FAILURE_KINDS = [
  'task-input-invalid',
  'list-not-found',
  'task-not-found',
  'storage-full',
  'storage-busy',
  'storage-unavailable',
] as const satisfies readonly TaskFailure['kind'][];

/**
 * Synchronous: a write has committed when the call returns ok. Every method returns a Result and
 * never throws for a data reason: invalid input and SQLite errors become a TaskFailure here, once.
 * Adapters: sqlite-task-repository.ts (the app), fake-task-repository.ts (tests).
 */
export type TaskRepository = {
  /** Readable rows only: an unreadable row is skipped and logged, never a failed list. */
  readonly lists: () => Result<readonly TaskList[], TaskFailure>;
  readonly tasksOf: (listId: number) => Result<readonly Task[], TaskFailure>;
  readonly addList: (input: NewList) => Result<TaskList, TaskFailure>;
  readonly addTask: (input: NewTask) => Result<Task, TaskFailure>;
  readonly setDone: (taskId: number, isDone: boolean) => Result<void, TaskFailure>;
  /** The list and its tasks, together or not at all. */
  readonly removeList: (listId: number) => Result<void, TaskFailure>;
};
