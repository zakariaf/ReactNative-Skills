// src/features/list-detail/list-detail-state.ts
// Which state the list-detail screen shows, decided from the parsed params and the repository's
// answer: a pure function, tested without rendering (screen-contracts). An id that parses but names
// no list is not-found, not invalid-link: the link was well formed, the list is gone.
import type { Result } from '@/core/result';
import type { Task, TaskFailure } from '@/data/tasks/task-repository';

export type ListDetailState =
  | { readonly kind: 'ready'; readonly tasks: readonly Task[] }
  | { readonly kind: 'empty' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'error'; readonly failure: TaskFailure }
  | { readonly kind: 'invalid-link' };

/** null tasks: the params did not parse, so the repository was never asked. */
export function listDetailStateOf(
  tasks: Result<readonly Task[], TaskFailure> | null,
): ListDetailState {
  if (tasks === null) return { kind: 'invalid-link' };
  if (!tasks.ok) {
    return tasks.error.kind === 'list-not-found'
      ? { kind: 'not-found' }
      : { kind: 'error', failure: tasks.error };
  }
  return tasks.value.length === 0 ? { kind: 'empty' } : { kind: 'ready', tasks: tasks.value };
}
