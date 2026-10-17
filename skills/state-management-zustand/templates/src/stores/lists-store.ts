// src/stores/lists-store.ts: the lists store: thin, hydrated once, every change saved before it is shown.
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { DEFAULT_LISTS_STATE, listsReducer } from '@/stores/lists-reducer';
import { useStores } from '@/stores/stores-context';

import type { Result } from '@/core/result';
import type { TaskFailure, TaskList, TaskRepository } from '@/data/tasks/task-repository';
import type { ListsAction, ListsState } from '@/stores/lists-reducer';
import type { StoreApi } from 'zustand/vanilla';

export type ListsStoreState = ListsState & {
  /** Saves a new list, then shows it. A failed write shows nothing and comes back as a value. */
  readonly addList: (name: string) => Result<TaskList, TaskFailure>;
  /** Re-reads every list from disk (updateAndPublish calls it after a write that spans stores). */
  readonly reload: () => void;
};

export type ListsStore = StoreApi<ListsStoreState>;

/** What the lists store reads and writes through: the Tasks repository (AppData's `tasks`). */
export type ListsStoreDeps = { readonly tasks: Pick<TaskRepository, 'lists' | 'addList'> };

/** The rows on disk as a reducer action, or why they could not be read. */
function readLists(tasks: ListsStoreDeps['tasks']): ListsAction {
  const lists = tasks.lists();
  return lists.ok
    ? { type: 'replace-lists', lists: lists.value }
    : { type: 'record-load-failure', failure: lists.error };
}

/** One store per app start: createStores calls it, never module code. */
export function createListsStore({ tasks }: ListsStoreDeps): ListsStore {
  return createStore<ListsStoreState>()((set, get) => ({
    ...listsReducer(DEFAULT_LISTS_STATE, readLists(tasks)),
    addList: (name) => {
      // 1. Persist: validated and committed when it returns ok (the repository assigns the id).
      const saved = tasks.addList({ name });
      if (!saved.ok) return saved;
      // 2. Publish what was saved, through the pure reducer.
      set(listsReducer(get(), { type: 'add-list', list: saved.value }));
      return saved;
    },
    reload: () => {
      const action = readLists(tasks);
      set(listsReducer(get(), action));
    },
  }));
}

/** Always with a selector: a primitive or a state reference, or a built value through useShallow. */
export function useListsStore<TSlice>(selector: (state: ListsStoreState) => TSlice): TSlice {
  return useStore(useStores().lists, selector);
}
