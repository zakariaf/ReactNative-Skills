// src/stores/lists-selectors.ts: named reads of the lists store.
// A selector returns a primitive or a reference that already lives in the state. One that builds a
// new array or object (selectListsByName) is read through useShallow at the call site:
//   const lists = useListsStore(useShallow(selectListsByName));
import type { TaskFailure, TaskList } from '@/data/tasks/task-repository';
import type { ListsState } from '@/stores/lists-reducer';
import type { ListsStoreState } from '@/stores/lists-store';

export const selectLists = (state: ListsState): readonly TaskList[] => state.lists;

export const selectListCount = (state: ListsState): number => state.lists.length;

export const selectListsLoadFailure = (state: ListsState): TaskFailure | null => state.loadFailure;

export const selectAddList = (state: ListsStoreState): ListsStoreState['addList'] => state.addList;

/** Builds a new array on every call: read it through useShallow. Name order, then oldest first. */
export function selectListsByName(state: ListsState): readonly TaskList[] {
  return [...state.lists].sort((first, second) => {
    const byName = first.name.localeCompare(second.name);
    return byName === 0 ? first.id - second.id : byName;
  });
}
