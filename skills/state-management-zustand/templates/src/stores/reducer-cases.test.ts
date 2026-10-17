// src/stores/reducer-cases.test.ts
import { caseProblem, mismatchOf } from '@/stores/reducer-cases';

import type { ReducerCases } from '@/stores/reducer-cases';

type Counter = { readonly count: number; readonly tags: readonly string[] };
type CounterAction = { readonly type: 'add'; readonly by: number };

const counterReducer = (state: Counter, action: CounterAction): Counter =>
  action.by === 0 ? state : { ...state, count: state.count + action.by };

const TABLE: ReducerCases<Counter, CounterAction> = {
  reducer: 'counterReducer',
  initial: { count: 1, tags: ['a'] },
  cases: [],
};

describe('mismatchOf', () => {
  it('matches objects key by key and leaves other keys free', () => {
    expect(mismatchOf({ count: 2, tags: ['a'] }, { count: 2 })).toBeNull();
  });

  it('names the path of the first difference', () => {
    expect(mismatchOf({ count: 2, tags: ['a', 'b'] }, { tags: ['a', 'c'] })).toBe(
      '$.tags[1]: expected "c", got "b"',
    );
  });

  it('compares arrays item by item, length included', () => {
    expect(mismatchOf([1, 2], [1])).toBe('$: expected 1 items, got [1,2]');
    expect(mismatchOf('x', [1])).toBe('$: expected 1 items, got "x"');
  });

  it('refuses a non-object where an object is expected', () => {
    expect(mismatchOf(null, { count: 1 })).toBe('$: expected an object, got null');
  });
});

describe('caseProblem', () => {
  it('passes a case whose expectation holds', () => {
    const item = { rule: 'adds', action: { type: 'add', by: 2 }, expect: { count: 3 } } as const;
    expect(caseProblem(counterReducer, TABLE, item)).toBeNull();
  });

  it('reports a changed state that misses the expectation', () => {
    const item = { rule: 'adds', action: { type: 'add', by: 2 }, expect: { count: 4 } } as const;
    expect(caseProblem(counterReducer, TABLE, item)).toBe('$.count: expected 4, got 3');
  });

  it('requires the same object for a change that changes nothing', () => {
    const same = { rule: 'zero', action: { type: 'add', by: 0 }, same: true } as const;
    const moved = { ...same, action: { type: 'add', by: 1 } } as const;
    expect(caseProblem(counterReducer, TABLE, same)).toBeNull();
    expect(caseProblem(counterReducer, TABLE, moved)).toBe(
      'a change that changes nothing returned a new object',
    );
  });

  it('starts from the case state when it has one', () => {
    const item = {
      rule: 'from-state',
      state: { count: 10, tags: [] },
      action: { type: 'add', by: 1 },
      expect: { count: 11, tags: [] },
    } as const;
    expect(caseProblem(counterReducer, TABLE, item)).toBeNull();
  });
});
