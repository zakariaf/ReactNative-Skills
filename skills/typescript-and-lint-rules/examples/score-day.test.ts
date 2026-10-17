// src/core/goals/score-day.test.ts
import { scoreDay, starsByCount, starsByFocus } from './score-day';

import type { ScoreDayOptions } from './score-day';

const CLOSED: ScoreDayOptions = {
  result: { tasksDone: 7, focusMinutes: 0, isClosed: true },
  goal: { kind: 'count', target: 7 },
  isPremium: false,
  snoozesUsed: 0,
};

describe('starsByCount', () => {
  it('gives three stars at the target and one far below it', () => {
    expect([starsByCount(7, 7), starsByCount(5, 7), starsByCount(2, 7)]).toStrictEqual([3, 2, 1]);
  });
});

describe('starsByFocus', () => {
  it('gives one star per threshold reached', () => {
    expect(starsByFocus(30, [25, 50, 90])).toBe(1);
    expect(starsByFocus(90, [25, 50, 90])).toBe(3);
  });
});

describe('scoreDay', () => {
  it('doubles the points with the Premium entitlement', () => {
    expect(scoreDay({ ...CLOSED, isPremium: true })).toStrictEqual({ stars: 3, points: 600 });
  });

  it('charges snoozes in points, never in stars', () => {
    expect(scoreDay({ ...CLOSED, snoozesUsed: 2 })).toStrictEqual({ stars: 3, points: 250 });
  });

  it('returns no stars for a day that is still open', () => {
    const open = { ...CLOSED, result: { ...CLOSED.result, isClosed: false } };

    expect(scoreDay(open)).toStrictEqual({ stars: 0, points: 0 });
  });
});
