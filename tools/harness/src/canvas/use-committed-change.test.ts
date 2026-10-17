// src/canvas/use-committed-change.test.ts
// no-providers: useCommittedChange reads no context; the data and diffEvents are its arguments.
import { renderHook } from '@testing-library/react-native';

import { nextChange, useCommittedChange } from './use-committed-change';

type Week = { readonly done: readonly number[] };
type Event = { readonly kind: 'day-updated'; readonly day: number; readonly to: number };

/** The surface's diff: one event per day whose count changed. */
function diffWeek(previous: Week, next: Week): readonly Event[] {
  return next.done.flatMap((to, day) =>
    previous.done[day] === to ? [] : [{ kind: 'day-updated', day, to }],
  );
}

const FIRST: Week = { done: [1, 2, 3] };

describe('nextChange', () => {
  it('shows the first data without events', () => {
    expect(nextChange(null, FIRST, diffWeek)).toStrictEqual({ seq: 1, state: FIRST, events: [] });
  });

  it('keeps the last change while there is no data', () => {
    const first = nextChange(null, FIRST, diffWeek);
    expect(nextChange(first, undefined, diffWeek)).toBe(first);
    expect(nextChange(null, undefined, diffWeek)).toBeNull();
  });

  it('gives the next data the next seq and the diffed events', () => {
    const first = nextChange(null, FIRST, diffWeek);
    expect(nextChange(first, { done: [1, 4, 3] }, diffWeek)).toStrictEqual({
      seq: 2,
      state: { done: [1, 4, 3] },
      events: [{ kind: 'day-updated', day: 1, to: 4 }],
    });
  });
});

describe('useCommittedChange', () => {
  it('is null while loading, then the first data without events', async () => {
    const view = await renderHook((data: Week | undefined) => useCommittedChange(data, diffWeek), {
      initialProps: undefined,
    });
    expect(view.result.current).toBeNull();
    await view.rerender(FIRST);
    expect(view.result.current).toStrictEqual({ seq: 1, state: FIRST, events: [] });
  });

  it('commits nothing when a refetch keeps the data identity (structural sharing)', async () => {
    const view = await renderHook((data: Week) => useCommittedChange(data, diffWeek), {
      initialProps: FIRST,
    });
    const first = view.result.current;
    await view.rerender(FIRST);
    expect(view.result.current).toBe(first);
  });

  it('turns an optimistic update and its rollback into two changes', async () => {
    const view = await renderHook((data: Week) => useCommittedChange(data, diffWeek), {
      initialProps: FIRST,
    });
    await view.rerender({ done: [1, 2, 4] });
    expect(view.result.current?.seq).toBe(2);
    expect(view.result.current?.events).toStrictEqual([{ kind: 'day-updated', day: 2, to: 4 }]);
    await view.rerender(FIRST);
    expect(view.result.current?.seq).toBe(3);
    expect(view.result.current?.events).toStrictEqual([{ kind: 'day-updated', day: 2, to: 3 }]);
  });
});
