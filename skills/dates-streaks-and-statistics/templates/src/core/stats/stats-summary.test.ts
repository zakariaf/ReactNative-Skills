// src/core/stats/stats-summary.test.ts
import { EMPTY_ACTIVITY_STATS, recordActivity } from '@/core/stats/activity-stats';

import { buildStatsSummary, rateOf, splitDuration } from './stats-summary';

import type { ActivityEvent, ActivityStats } from '@/core/stats/activity-stats';

const TODAY = '2026-09-26';
const DONE: ActivityEvent = { isSuccess: true, durationMs: 1_800_000, counters: {} };

function statsOf(events: readonly ActivityEvent[]): ActivityStats {
  return events.reduce((stats, event) => recordActivity(stats, event, TODAY), EMPTY_ACTIVITY_STATS);
}

describe('buildStatsSummary', () => {
  it('shows the empty state to a new user', () => {
    const view = buildStatsSummary({
      stats: EMPTY_ACTIVITY_STATS,
      streak: { activeDays: 0, current: 0, best: 0 },
      today: TODAY,
      counterIds: [],
    });

    expect([view.isEmpty, view.overview.successRate, view.week.max]).toStrictEqual([true, 0, 1]);
    expect(view.streak).toStrictEqual({ activeDays: 0, current: 0, best: 0 });
  });

  it('derives every number from the stored sections', () => {
    const stats = statsOf([DONE, DONE, { ...DONE, isSuccess: false }, DONE]);
    const streak = { activeDays: 2, current: 2, best: 2 };
    const view = buildStatsSummary({ stats, streak, today: TODAY, counterIds: ['subtasks-done'] });

    expect(view.overview).toStrictEqual({
      total: 4,
      successes: 3,
      successRate: 0.75,
      duration: { hours: 2, minutes: 0 },
    });
    expect([view.runs, view.bestDay]).toStrictEqual([
      { current: 1, longest: 2 },
      { date: TODAY, count: 4 },
    ]);
    expect(view.streak).toStrictEqual({ activeDays: 2, current: 2, best: 2 });
    expect(view.week.bars.at(-1)).toStrictEqual({ date: TODAY, weekday: 6, count: 4 });
    expect([view.week.bars.length, view.week.max]).toStrictEqual([7, 4]);
    expect(view.counters).toStrictEqual([{ id: 'subtasks-done', value: 0 }]);
  });

  it('passes the streak counts through unchanged', () => {
    const streak = { activeDays: 70, current: 5, best: 8 };
    const view = buildStatsSummary({
      stats: EMPTY_ACTIVITY_STATS,
      streak,
      today: TODAY,
      counterIds: [],
    });

    expect(view.streak).toStrictEqual({ activeDays: 70, current: 5, best: 8 });
  });

  it('has no streak block in an app without streaks', () => {
    const view = buildStatsSummary({
      stats: EMPTY_ACTIVITY_STATS,
      streak: null,
      today: TODAY,
      counterIds: [],
    });

    expect(view.streak).toBeNull();
  });
});

describe('splitDuration', () => {
  it('splits a duration into whole hours and minutes', () => {
    expect([splitDuration(0), splitDuration(8_040_000), splitDuration(59_999)]).toStrictEqual([
      { hours: 0, minutes: 0 },
      { hours: 2, minutes: 14 },
      { hours: 0, minutes: 0 },
    ]);
  });
});

describe('rateOf', () => {
  it('gives a 0..1 share and 0 for an empty whole', () => {
    expect([rateOf(3, 4), rateOf(0, 0)]).toStrictEqual([0.75, 0]);
  });
});
