// src/stores/lists-reducer.test.ts
import fc from 'fast-check';

import { DEFAULT_LISTS_STATE, listsReducer } from '@/stores/lists-reducer';
import { LISTS_REDUCER_CASES } from '@/stores/lists-reducer-cases';
import { caseProblem } from '@/stores/reducer-cases';

import type { TaskList } from '@/data/tasks/task-repository';

const RULES = LISTS_REDUCER_CASES.cases.map((item) => [item.rule, item] as const);

const LIST = fc.record({
  id: fc.integer({ min: 1, max: 1_000 }),
  name: fc.string({ minLength: 1, maxLength: 20 }),
  createdAtMs: fc.nat(),
});

describe('listsReducer', () => {
  it.each(RULES)('keeps %s', (_rule, item) => {
    expect(caseProblem(listsReducer, LISTS_REDUCER_CASES, item)).toBeNull();
  });

  it('leaves its input unchanged', () => {
    const state = Object.freeze({ ...DEFAULT_LISTS_STATE, lists: Object.freeze([]) });
    const list: TaskList = { id: 7, name: 'Errands', createdAtMs: 0 };
    expect(listsReducer(state, { type: 'add-list', list }).lists).toStrictEqual([list]);
    expect(state.lists).toStrictEqual([]);
  });

  it('adds a list once, however often it arrives', () => {
    fc.assert(
      fc.property(fc.array(LIST, { maxLength: 8 }), (lists) => {
        const once = lists.reduce(
          (state, list) => listsReducer(state, { type: 'add-list', list: { ...list } }),
          DEFAULT_LISTS_STATE,
        );
        const twice = lists.reduce(
          (state, list) => listsReducer(state, { type: 'add-list', list: { ...list } }),
          once,
        );
        expect(twice).toBe(once);
        expect(new Set(once.lists.map((list) => list.id)).size).toBe(once.lists.length);
      }),
    );
  });
});
