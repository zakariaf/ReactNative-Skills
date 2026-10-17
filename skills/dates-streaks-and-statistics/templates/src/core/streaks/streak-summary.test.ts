// src/core/streaks/streak-summary.test.ts
import { EMPTY_DAY_STREAK, recordDay } from '@/core/streaks/day-streak';

import { buildStreakSummary, streakCountsOf } from './streak-summary';

import type { DayStreak } from '@/core/streaks/day-streak';

type TasksDay = { readonly firstTaskId: number };

function active(days: readonly string[]): DayStreak<TasksDay> {
  return days.reduce<DayStreak<TasksDay>>(
    (log, date) => recordDay(log, date, { firstTaskId: 7 }),
    EMPTY_DAY_STREAK,
  );
}

describe('buildStreakSummary', () => {
  it('shows a new user: nothing done, today open, every other day missed', () => {
    const view = buildStreakSummary(active([]), '2026-09-26');

    expect([view.isDone, view.todayResult, view.currentStreak]).toStrictEqual([false, null, 0]);
    expect(view.week.map((day) => day.mark)).toStrictEqual([
      'missed',
      'missed',
      'missed',
      'missed',
      'missed',
      'missed',
      'today',
    ]);
  });

  it('shows today done with its first result, the streak and ISO weekdays', () => {
    const view = buildStreakSummary(active(['2026-09-25', '2026-09-26']), '2026-09-26');

    expect([view.isDone, view.todayResult, view.currentStreak]).toStrictEqual([
      true,
      { firstTaskId: 7 },
      2,
    ]);
    expect(view.week.map((day) => day.weekday)).toStrictEqual([7, 1, 2, 3, 4, 5, 6]);
    expect(view.week.at(-1)).toStrictEqual({
      date: '2026-09-26',
      weekday: 6,
      mark: 'done',
      isToday: true,
    });
  });

  it("keeps yesterday's streak alive until today is done", () => {
    const view = buildStreakSummary(active(['2026-09-25']), '2026-09-26');

    expect([view.isDone, view.currentStreak, view.bestStreak]).toStrictEqual([false, 1, 1]);
  });
});

describe('streakCountsOf', () => {
  it('reads active days and the best streak from the stored counters', () => {
    const log = { ...active(['2026-09-25', '2026-09-26']), activeDays: 70, bestStreak: 9 };

    expect(streakCountsOf(log, '2026-09-26')).toStrictEqual({
      activeDays: 70,
      current: 2,
      best: 9,
    });
  });

  it('shows no current streak once a day is missed', () => {
    expect(streakCountsOf(active(['2026-09-20']), '2026-09-26')).toStrictEqual({
      activeDays: 1,
      current: 0,
      best: 1,
    });
  });
});
