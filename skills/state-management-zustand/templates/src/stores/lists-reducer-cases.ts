// src/stores/lists-reducer-cases.ts: the lists rules as data; lists-reducer.test.ts and check-reducers run them.
import type { ListsAction, ListsState } from '@/stores/lists-reducer';
import type { ReducerCases } from '@/stores/reducer-cases';

const GROCERIES = { id: 1, name: 'Groceries', createdAtMs: 1_000 } as const;
const WORK = { id: 2, name: 'Work', createdAtMs: 2_000 } as const;
const BUSY = { kind: 'storage-busy' } as const;

export const LISTS_REDUCER_CASES: ReducerCases<ListsState, ListsAction> = {
  reducer: 'listsReducer',
  initial: { lists: [GROCERIES], loadFailure: null },
  cases: [
    {
      rule: 'add-list-appends',
      action: { type: 'add-list', list: WORK },
      expect: { lists: [GROCERIES, WORK] },
    },
    { rule: 'add-list-once', action: { type: 'add-list', list: GROCERIES }, same: true },
    {
      rule: 'replace-clears-failure',
      state: { lists: [], loadFailure: BUSY },
      action: { type: 'replace-lists', lists: [WORK] },
      expect: { lists: [WORK], loadFailure: null },
    },
    {
      rule: 'failure-empties',
      action: { type: 'record-load-failure', failure: BUSY },
      expect: { lists: [], loadFailure: BUSY },
    },
  ],
};
