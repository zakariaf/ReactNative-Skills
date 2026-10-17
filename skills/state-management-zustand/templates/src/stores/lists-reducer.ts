// src/stores/lists-reducer.ts: the rules of the lists the app shows; pure, tested without React.
import type { TaskFailure, TaskList } from '@/data/tasks/task-repository';

/** What the lists store holds: a copy of the rows on disk, never more. */
export type ListsState = {
  readonly lists: readonly TaskList[];
  /** Why the last read failed (the lists are then empty), or null after a good read. */
  readonly loadFailure: TaskFailure | null;
};

/** Imperative kebab-case requests. A new list arrives as the repository saved it (id included). */
export type ListsAction =
  | { readonly type: 'add-list'; readonly list: TaskList }
  | { readonly type: 'replace-lists'; readonly lists: readonly TaskList[] }
  | { readonly type: 'record-load-failure'; readonly failure: TaskFailure };

export const DEFAULT_LISTS_STATE: ListsState = { lists: [], loadFailure: null };

/**
 * Pure: no clock, no randomness, no mutation. Returns the SAME object when nothing changes (a list
 * that is already there), so the store neither writes nor re-renders.
 */
export function listsReducer(state: ListsState, action: ListsAction): ListsState {
  switch (action.type) {
    case 'add-list':
      return state.lists.some((list) => list.id === action.list.id)
        ? state
        : { ...state, lists: [...state.lists, action.list] };
    case 'replace-lists':
      return { ...state, lists: action.lists, loadFailure: null };
    case 'record-load-failure':
      return { ...state, lists: [], loadFailure: action.failure };
  }
}
