// src/features/insights/canvas/diff-events.test.ts
import { diffEvents } from './diff-events';

import type { WeeklyChartState } from './canvas-model';

const WEEK: WeeklyChartState = { weekOf: '2026-09-28', done: [3, 0, 5, 2, 4, 1, 6], goal: 4 };

describe('diffEvents', () => {
  it('derives one day-updated event per changed day, with its old and new value', () => {
    const next = { ...WEEK, done: [3, 0, 6, 2, 4, 1, 6] };
    expect(diffEvents(WEEK, next)).toStrictEqual([{ kind: 'day-updated', day: 2, from: 5, to: 6 }]);
  });

  it('derives nothing for an equal state (a refetch that changed nothing)', () => {
    expect(diffEvents(WEEK, { ...WEEK, done: [...WEEK.done] })).toStrictEqual([]);
  });

  it('starts a new week from the old bars, whatever the new counts are', () => {
    const next = { weekOf: '2026-10-05', done: [1, 0, 0, 0, 0, 0, 0], goal: 4 };
    expect(diffEvents(WEEK, next)).toStrictEqual([{ kind: 'week-started', previous: WEEK.done }]);
  });

  it('reverses an optimistic update when the rollback arrives', () => {
    const optimistic = { ...WEEK, done: [3, 1, 5, 2, 4, 1, 6] };
    expect(diffEvents(optimistic, WEEK)).toStrictEqual([
      { kind: 'day-updated', day: 1, from: 1, to: 0 },
    ]);
  });
});
