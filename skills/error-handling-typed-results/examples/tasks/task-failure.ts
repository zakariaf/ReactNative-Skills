// src/core/tasks/task-failure.ts (example: a shape to imitate, never copied)
// One failure family per boundary. Each member: a stable kebab-case kind plus the typed params a
// screen needs to explain it or a test needs to assert it. No message, no Error, no vendor type.

/** Why a task operation failed in a way the app expects and handles. */
export type TaskFailure =
  | { readonly kind: 'task-not-found'; readonly taskId: string }
  | { readonly kind: 'task-title-taken'; readonly title: string }
  | { readonly kind: 'task-title-empty' }
  | { readonly kind: 'storage-full' }
  | { readonly kind: 'storage-busy' }
  /** Anything the mapper did not recognise; the raw error was recorded in the error log. */
  | { readonly kind: 'storage-unavailable'; readonly code: number | null };

/** The kinds as data, for exhaustiveness tests (every kind has a message in every locale). */
export const TASK_FAILURE_KINDS = [
  'task-not-found',
  'task-title-taken',
  'task-title-empty',
  'storage-full',
  'storage-busy',
  'storage-unavailable',
] as const satisfies readonly TaskFailure['kind'][];
