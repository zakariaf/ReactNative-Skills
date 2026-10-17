// src/core/streaks/streak-summary.ts
// Pure: the streak section + today -> everything a streak card or a week strip shows, and the three
// streak numbers a statistics screen shows. No text and no formatting: components format these
// numbers through the i18n layer. The "new day in" line comes from src/core/countdown/.
import { isoWeekday } from '@/core/dates/date-key';
import { currentStreak, isDayDone, recentDays } from '@/core/streaks/day-streak';

import type { DateKey } from '@/core/dates/date-key';
import type { DayStreak } from '@/core/streaks/day-streak';

/** A week-strip cell: a recorded day, an unplayed today, or a missed day. */
export type DayMark = 'done' | 'missed' | 'today';

/** One cell of the week strip. */
export type WeekDay = {
  readonly date: DateKey;
  /** ISO weekday 1..7 (1 = Monday): picks the weekday letter and the screen-reader name. */
  readonly weekday: number;
  readonly mark: DayMark;
  readonly isToday: boolean;
};

/** Every number and flag of a streak card. */
export type StreakSummary<TDay> = {
  readonly today: DateKey;
  readonly isDone: boolean;
  /** Today's first result, or null before today's first event. */
  readonly todayResult: TDay | null;
  readonly currentStreak: number;
  readonly bestStreak: number;
  readonly activeDays: number;
  /** Seven days, oldest first. Laid out in a row, so a right-to-left layout mirrors it. */
  readonly week: readonly WeekDay[];
};

/**
 * The streak numbers of a statistics screen: the shape buildStatsSummary takes as `streak`
 * (src/core/stats/ declares the same shape, so statistics never import this folder).
 */
export type StreakCounts = {
  readonly activeDays: number;
  readonly current: number;
  readonly best: number;
};

const WEEK_DAYS = 7;

function markOf(isDone: boolean, isToday: boolean): DayMark {
  if (isDone) return 'done';
  return isToday ? 'today' : 'missed';
}

/** Builds the streak card's model from the stored section and today's key. */
export function buildStreakSummary<TDay>(
  log: DayStreak<TDay>,
  today: DateKey,
): StreakSummary<TDay> {
  const week = recentDays(log, today, WEEK_DAYS).map(({ date, isDone }): WeekDay => {
    const isToday = date === today;
    return { date, weekday: isoWeekday(date), mark: markOf(isDone, isToday), isToday };
  });
  return {
    today,
    isDone: isDayDone(log, today),
    todayResult: log.byDay[today] ?? null,
    currentStreak: currentStreak(log, today),
    bestStreak: log.bestStreak,
    activeDays: log.activeDays,
    week,
  };
}

/** The stored counters and today's current streak, for buildStatsSummary's `streak` input. */
export function streakCountsOf<TDay>(log: DayStreak<TDay>, today: DateKey): StreakCounts {
  return {
    activeDays: log.activeDays,
    current: currentStreak(log, today),
    best: log.bestStreak,
  };
}
