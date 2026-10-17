// src/features/tasks/task-failure-message.ts (example: a shape to imitate, never copied)
// The presentation edge: each failure kind maps to a message key in the app's catalogs. The
// `satisfies Record<TaskFailure['kind'], string>` makes a new kind a compile error here until it has
// a key; check-error-spine proves every key exists in the source catalog.
import type { TaskFailure } from '@/core/tasks/task-failure';

export const TASK_FAILURE_MESSAGE = {
  'task-not-found': 'tasks.error.not-found',
  'task-title-taken': 'tasks.error.title-taken',
  'task-title-empty': 'tasks.error.title-empty',
  'storage-full': 'errors.storage-full',
  'storage-busy': 'errors.storage-busy',
  'storage-unavailable': 'errors.storage-unavailable',
} as const satisfies Record<TaskFailure['kind'], string>;

/** What the screen renders through t(): a catalog key and its ICU values. */
export type FailureMessage = {
  readonly key: (typeof TASK_FAILURE_MESSAGE)[TaskFailure['kind']];
  readonly values: Readonly<Record<string, string>>;
};

/** The message for a failure; params become ICU values, never concatenated text. */
export function taskFailureMessage(failure: TaskFailure): FailureMessage {
  const key = TASK_FAILURE_MESSAGE[failure.kind];
  switch (failure.kind) {
    case 'task-title-taken':
      return { key, values: { title: failure.title } };
    case 'task-not-found':
    case 'task-title-empty':
    case 'storage-full':
    case 'storage-busy':
    case 'storage-unavailable':
      return { key, values: {} };
  }
}
