// src/ui/feedback/screen-state.test.ts
import fc from 'fast-check';

import { listScreenStateOf } from './screen-state';

import type { ListSnapshot } from './screen-state';

const IDLE: ListSnapshot<string> = {
  items: undefined,
  isFetching: false,
  isPaused: false,
  failureKey: null,
  isFiltered: false,
};
const FAILURE = 'feedback.failure.unknown';

describe('listScreenStateOf', () => {
  it('shows the placeholder while the first load runs', () => {
    expect(listScreenStateOf({ ...IDLE, isFetching: true })).toStrictEqual({ kind: 'loading' });
  });

  it('waits for the network instead of failing when nothing is cached', () => {
    expect(listScreenStateOf({ ...IDLE, isPaused: true })).toStrictEqual({ kind: 'offline' });
  });

  it('fails only when the load failed, with the failure message', () => {
    expect(listScreenStateOf({ ...IDLE, failureKey: FAILURE })).toStrictEqual({
      kind: 'failed',
      messageKey: FAILURE,
    });
  });

  it('tells nothing-yet from nothing-matches', () => {
    expect(listScreenStateOf({ ...IDLE, items: [] })).toStrictEqual({ kind: 'empty' });
    expect(listScreenStateOf({ ...IDLE, items: [], isFiltered: true })).toStrictEqual({
      kind: 'filtered-empty',
    });
  });

  it('keeps the items on screen during a refresh', () => {
    expect(listScreenStateOf({ ...IDLE, items: ['a'], isFetching: true })).toStrictEqual({
      kind: 'ready',
      items: ['a'],
      isRefreshing: true,
      notice: null,
    });
  });

  it('keeps cached items when offline or when a refresh failed, with a notice', () => {
    expect(listScreenStateOf({ ...IDLE, items: ['a'], isPaused: true })).toMatchObject({
      kind: 'ready',
      notice: { kind: 'offline' },
    });
    expect(listScreenStateOf({ ...IDLE, items: ['a'], failureKey: FAILURE })).toMatchObject({
      kind: 'ready',
      notice: { kind: 'refresh-failed', messageKey: FAILURE },
    });
  });

  it('keeps empty out until a load succeeded, and keeps failed out while items exist', () => {
    const snapshot = fc.record({
      items: fc.option(fc.array(fc.string(), { maxLength: 3 }), { nil: undefined }),
      isFetching: fc.boolean(),
      isPaused: fc.boolean(),
      failureKey: fc.constantFrom(null, FAILURE),
      isFiltered: fc.boolean(),
    });
    fc.assert(
      fc.property(snapshot, (facts) => {
        const allowed =
          facts.items === undefined
            ? ['loading', 'offline', 'failed']
            : ['empty', 'filtered-empty', 'ready'];
        expect(allowed).toContain(listScreenStateOf(facts).kind);
      }),
    );
  });
});
