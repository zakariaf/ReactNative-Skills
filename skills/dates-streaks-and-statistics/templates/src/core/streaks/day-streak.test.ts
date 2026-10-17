// src/core/streaks/day-streak.test.ts
import fc from 'fast-check';

import { addDays } from '@/core/dates/date-key';

import {
  currentStreak,
  DAY_STREAK_KEEP_DAYS,
  EMPTY_DAY_STREAK,
  isDayDone,
  recentDays,
  recordDay,
  streakOfDays,
} from './day-streak';

import type { DayStreak } from './day-streak';

type TasksDay = { readonly firstTaskId: number };

const FIRST = { firstTaskId: 1 };
const SECOND = { firstTaskId: 2 };

function active(days: readonly string[]): DayStreak<TasksDay> {
  return days.reduce<DayStreak<TasksDay>>(
    (log, date) => recordDay(log, date, FIRST),
    EMPTY_DAY_STREAK,
  );
}

describe('recordDay', () => {
  it('counts consecutive days and keeps the best streak', () => {
    const log = active(['2026-09-24', '2026-09-25', '2026-09-26']);

    expect([log.streak.length, log.bestStreak, log.activeDays]).toStrictEqual([3, 3, 3]);
  });

  it('starts a new streak after a missed day but keeps the best one', () => {
    const log = active(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-24']);

    expect(log.streak).toStrictEqual({ lastDate: '2026-09-24', length: 1 });
    expect(log.bestStreak).toBe(3);
  });

  it('keeps the first result of a day: a repeat returns the same object', () => {
    const first = recordDay<TasksDay>(EMPTY_DAY_STREAK, '2026-09-26', FIRST);

    expect(recordDay(first, '2026-09-26', SECOND)).toBe(first);
  });

  it('keeps the streak when the clock goes back, and records the earlier day once', () => {
    const later = active(['2026-09-25', '2026-09-26']);
    const earlier = recordDay(later, '2026-09-20', FIRST);

    expect(earlier.streak).toStrictEqual(later.streak);
    expect([isDayDone(earlier, '2026-09-26'), isDayDone(earlier, '2026-09-20')]).toStrictEqual([
      true,
      true,
    ]);
    expect(recordDay(earlier, '2026-09-20', SECOND)).toBe(earlier);
  });

  it('prunes old days without shortening the streak or the active-day count', () => {
    const days = Array.from({ length: DAY_STREAK_KEEP_DAYS + 5 }, (_, i) =>
      addDays('2026-01-01', i),
    );
    const log = active(days);

    expect(Object.keys(log.byDay)).toHaveLength(DAY_STREAK_KEEP_DAYS);
    expect([log.streak.length, log.activeDays]).toStrictEqual([days.length, days.length]);
  });

  it('ignores a day older than the kept window, which may have been counted already', () => {
    const days = Array.from({ length: DAY_STREAK_KEEP_DAYS + 5 }, (_, i) =>
      addDays('2026-01-01', i),
    );
    const log = active(days);

    expect(recordDay(log, '2026-01-02', SECOND)).toBe(log);
  });

  it('freezes the streak after a clock set forward and then corrected (a deliberate trade-off)', () => {
    // One event on a future day F: lastDate is F, so real days before F never extend the streak.
    const future = active(['2026-09-25', '2026-11-01']);
    const corrected = recordDay(future, '2026-09-26', FIRST);

    expect(corrected.streak).toStrictEqual({ lastDate: '2026-11-01', length: 1 });
    expect(corrected.activeDays).toBe(3);
    // A real day 60 or more days before F is outside the kept window: ignored, not counted.
    expect(recordDay(future, '2026-09-01', FIRST)).toBe(future);
    // Rebuilding from the kept history with streakOfDays is the repair (support or migration tool).
    expect(streakOfDays(['2026-09-25', '2026-09-26']).streak).toStrictEqual({
      lastDate: '2026-09-26',
      length: 2,
    });
  });

  it('rejects a key that is not a calendar day', () => {
    expect(() => recordDay<TasksDay>(EMPTY_DAY_STREAK, '2026-02-30', FIRST)).toThrow(RangeError);
  });
});

describe('currentStreak', () => {
  it('stays alive until the end of the day after the last active day', () => {
    const log = active(['2026-09-24', '2026-09-25', '2026-09-26']);

    expect(
      ['2026-09-26', '2026-09-27', '2026-09-28'].map((today) => currentStreak(log, today)),
    ).toStrictEqual([3, 3, 0]);
  });

  it('keeps showing the streak when the clock is set back before the last active day', () => {
    expect(currentStreak(active(['2026-09-25', '2026-09-26']), '2026-09-24')).toBe(2);
  });

  it('is zero for a new user', () => {
    expect(currentStreak(EMPTY_DAY_STREAK, '2026-09-26')).toBe(0);
  });
});

describe('recentDays', () => {
  it('lists the last seven days oldest first, with done marks', () => {
    expect(recentDays(active(['2026-09-21', '2026-09-26']), '2026-09-26', 7)).toStrictEqual([
      { date: '2026-09-20', isDone: false },
      { date: '2026-09-21', isDone: true },
      { date: '2026-09-22', isDone: false },
      { date: '2026-09-23', isDone: false },
      { date: '2026-09-24', isDone: false },
      { date: '2026-09-25', isDone: false },
      { date: '2026-09-26', isDone: true },
    ]);
  });
});

describe('streakOfDays', () => {
  it('derives the streak from an unordered history with repeats', () => {
    expect(
      streakOfDays(['2026-09-26', '2026-09-24', '2026-09-25', '2026-09-25', '2026-09-20']),
    ).toStrictEqual({
      activeDays: 4,
      streak: { lastDate: '2026-09-26', length: 3 },
      bestStreak: 3,
    });
  });

  it('agrees with recording the same days in order', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 40 }), { maxLength: 25 }), (offsets) => {
        const days = offsets.map((offset) => addDays('2026-09-01', offset));
        const log = active([...days].sort());
        const derived = streakOfDays(days);

        expect(derived).toStrictEqual({
          activeDays: log.activeDays,
          streak: log.streak,
          bestStreak: log.bestStreak,
        });
      }),
      { seed: 7, numRuns: 300 },
    );
  });
});
