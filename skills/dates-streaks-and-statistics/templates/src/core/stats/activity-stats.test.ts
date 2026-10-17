// src/core/stats/activity-stats.test.ts
import fc from 'fast-check';

import { addDays } from '@/core/dates/date-key';

import {
  EMPTY_ACTIVITY_STATS,
  measureCounters,
  recordActivity,
  STATS_KEEP_DAYS,
} from './activity-stats';

import type { ActivityEvent, ActivityStats } from './activity-stats';

const TODAY = '2026-09-26';
const ON_TIME: ActivityEvent = { isSuccess: true, durationMs: 60_000, counters: {} };
const LATE: ActivityEvent = { ...ON_TIME, isSuccess: false };

function fold(events: readonly ActivityEvent[], day = TODAY): ActivityStats {
  return events.reduce((stats, event) => recordActivity(stats, event, day), EMPTY_ACTIVITY_STATS);
}

describe('recordActivity', () => {
  it('adds up totals, successes, failures and time', () => {
    const stats = fold([ON_TIME, LATE, ON_TIME]);

    expect([stats.total, stats.successes, stats.failures, stats.durationMs]).toStrictEqual([
      3, 2, 1, 180_000,
    ]);
  });

  it('resets the run of successes on a failure and keeps the longest', () => {
    const stats = fold([ON_TIME, ON_TIME, ON_TIME, LATE, ON_TIME]);

    expect([stats.currentRun, stats.longestRun]).toStrictEqual([1, 3]);
  });

  it('keeps per-day buckets for the window, counted back from the newest day', () => {
    const days = ['2026-09-01', '2026-09-12', '2026-09-13', TODAY, TODAY];
    const stats = days.reduce(
      (acc, day) => recordActivity(acc, ON_TIME, day),
      EMPTY_ACTIVITY_STATS,
    );

    expect(stats.perDay).toStrictEqual({
      '2026-09-13': { count: 1, durationMs: 60_000 },
      [TODAY]: { count: 2, durationMs: 120_000 },
    });
    expect(stats.total).toBe(5);
  });

  it('keeps the best day after its bucket leaves the window', () => {
    const busy = ['2026-08-01', '2026-08-01', '2026-08-01'].reduce(
      (acc, day) => recordActivity(acc, ON_TIME, day),
      EMPTY_ACTIVITY_STATS,
    );
    const later = recordActivity(busy, ON_TIME, TODAY);

    expect(later.perDay['2026-08-01']).toBeUndefined();
    expect(later.bestDay).toStrictEqual({ date: '2026-08-01', count: 3 });
  });

  it('counts an event on a day older than the window without a bucket', () => {
    const recent = recordActivity(EMPTY_ACTIVITY_STATS, ON_TIME, TODAY);
    const old = recordActivity(recent, ON_TIME, addDays(TODAY, -STATS_KEEP_DAYS));

    expect([old.total, Object.keys(old.perDay)]).toStrictEqual([2, [TODAY]]);
  });

  it("folds counters by 'sum' or 'max'", () => {
    const event = (value: number): ActivityEvent => ({
      ...ON_TIME,
      counters: {
        'subtasks-completed': { value, aggregate: 'sum' },
        'longest-checklist': { value, aggregate: 'max' },
      },
    });

    expect(fold([event(4), event(7), event(2)]).counters).toStrictEqual({
      'subtasks-completed': 13,
      'longest-checklist': 7,
    });
  });

  it('grows the total by one for every event, whatever its day', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -30, max: 30 }), { maxLength: 40 }), (offsets) => {
        let stats = EMPTY_ACTIVITY_STATS;
        for (const offset of offsets) {
          const next = recordActivity(stats, ON_TIME, addDays(TODAY, offset));

          expect(next.total).toBe(stats.total + 1);
          stats = next;
        }
      }),
      { seed: 5, numRuns: 200 },
    );
  });
});

describe('measureCounters', () => {
  it('measures every committed step: sum adds, max keeps the largest', () => {
    const specs = [
      { id: 'subtasks-completed', aggregate: 'sum', measure: (step: string) => step.length },
      { id: 'longest-checklist', aggregate: 'max', measure: (step: string) => step.length },
    ] as const;

    expect(measureCounters(specs, ['a', 'abc', ''])).toStrictEqual({
      'subtasks-completed': { value: 4, aggregate: 'sum' },
      'longest-checklist': { value: 3, aggregate: 'max' },
    });
  });

  it('gives zero for an event without steps', () => {
    const specs = [{ id: 'longest-checklist', aggregate: 'max', measure: () => 9 }] as const;

    expect(measureCounters(specs, [])).toStrictEqual({
      'longest-checklist': { value: 0, aggregate: 'max' },
    });
  });
});
