// src/features/lists/lists-state.ts
// Which state the Lists screen shows, decided from the repository's answer. The states are the
// contract's (contracts/screens.json, screen "lists"): default, empty and error. A state without a
// layout would be a blank screen, so every kind here has one in lists-screen.tsx.
import type { Result } from '@/core/result';
import type { TaskFailure, TaskList } from '@/data/tasks/task-repository';

export type ListsState =
  | { readonly kind: 'default'; readonly lists: readonly TaskList[] }
  | { readonly kind: 'empty' }
  | { readonly kind: 'error'; readonly failure: TaskFailure };

export function listsStateOf(result: Result<readonly TaskList[], TaskFailure>): ListsState {
  if (!result.ok) return { kind: 'error', failure: result.error };
  return result.value.length === 0 ? { kind: 'empty' } : { kind: 'default', lists: result.value };
}
