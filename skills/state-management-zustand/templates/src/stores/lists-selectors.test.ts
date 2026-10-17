// src/stores/lists-selectors.test.ts
import {
  selectListCount,
  selectLists,
  selectListsByName,
  selectListsLoadFailure,
} from '@/stores/lists-selectors';

import type { ListsState } from '@/stores/lists-reducer';

const STATE: ListsState = {
  lists: [
    { id: 3, name: 'Work', createdAtMs: 0 },
    { id: 2, name: 'Errands', createdAtMs: 0 },
    { id: 1, name: 'Errands', createdAtMs: 0 },
  ],
  loadFailure: null,
};

describe('lists selectors', () => {
  it('returns references that live in the state', () => {
    expect(selectLists(STATE)).toBe(STATE.lists);
    expect(selectListsLoadFailure(STATE)).toBeNull();
    expect(selectListCount(STATE)).toBe(3);
  });

  it('sorts by name, then by id, without touching the state', () => {
    expect(selectListsByName(STATE).map((list) => list.id)).toStrictEqual([1, 2, 3]);
    expect(STATE.lists.map((list) => list.id)).toStrictEqual([3, 2, 1]);
  });

  it('builds a new array on every call (so call sites need useShallow)', () => {
    expect(selectListsByName(STATE)).not.toBe(selectListsByName(STATE));
    expect(selectListsByName(STATE)).toStrictEqual(selectListsByName(STATE));
  });
});
