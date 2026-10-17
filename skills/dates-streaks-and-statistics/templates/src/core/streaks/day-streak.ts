// src/core/streaks/day-streak.ts
// Pure streak bookkeeping on local civil-date keys. One entry per active day (the first event of a
// day counts), a streak stored incrementally so the pruned window never shortens it, and a derived
// fold over a full history that agrees with the incremental one. Time arrives as DateKey values.
import { addDays, daysBetween, isDateKey } from '@/core/dates/date-key';

import type { DateKey } from '@/core/dates/date-key';

/** Days of `byDay` kept before the newest active day; the counts and the streak are stored apart. */
export const DAY_STREAK_KEEP_DAYS = 60;

/** The current run of consecutive active days. */
export type StreakRun = { readonly lastDate: DateKey | null; readonly length: number };

/** The stored streak section. `TDay` is what the app keeps for a day (its first result). */
export type DayStreak<TDay> = {
  /** The first result of each active day, pruned to DAY_STREAK_KEEP_DAYS before the newest one. */
  readonly byDay: Readonly<Record<DateKey, TDay>>;
  /** Every day ever recorded: a stored counter, so pruning `byDay` never lowers it. */
  readonly activeDays: number;
  readonly streak: StreakRun;
  readonly bestStreak: number;
};

/** What a full history of active days says, computed on read (see streakOfDays). */
export type DerivedStreak = {
  readonly activeDays: number;
  readonly streak: StreakRun;
  readonly bestStreak: number;
};

/** The section of a user who was never active (assignable to any `DayStreak<TDay>`). */
export const EMPTY_DAY_STREAK: DayStreak<never> = Object.freeze({
  byDay: Object.freeze({}),
  activeDays: 0,
  streak: Object.freeze({ lastDate: null, length: 0 }),
  bestStreak: 0,
});

function extend(streak: StreakRun, date: DateKey): StreakRun {
  if (streak.lastDate === null) return { lastDate: date, length: 1 };
  const gap = daysBetween(streak.lastDate, date);
  if (gap === 1) return { lastDate: date, length: streak.length + 1 };
  if (gap > 1) return { lastDate: date, length: 1 };
  return streak; // the same day, or the clock went back: the run never changes or double-counts
}

function keptWindow<TDay>(
  byDay: Readonly<Record<DateKey, TDay>>,
  newest: DateKey,
): Readonly<Record<DateKey, TDay>> {
  return Object.fromEntries(
    Object.entries(byDay).filter(([date]) => daysBetween(date, newest) < DAY_STREAK_KEEP_DAYS),
  );
}

/**
 * Records `day` as the result of `date`. The first event of a day counts; a repeat, or a date
 * older than the kept window (it may have been counted and pruned), returns `log` itself.
 */
export function recordDay<TDay>(log: DayStreak<TDay>, date: DateKey, day: TDay): DayStreak<TDay> {
  if (!isDateKey(date)) throw new RangeError(`recordDay: not a YYYY-MM-DD day: ${date}`);
  if (Object.hasOwn(log.byDay, date)) return log;
  const newestBefore = log.streak.lastDate;
  if (newestBefore !== null && daysBetween(date, newestBefore) >= DAY_STREAK_KEEP_DAYS) return log;
  const streak = extend(log.streak, date);
  return {
    byDay: keptWindow({ ...log.byDay, [date]: day }, streak.lastDate ?? date),
    activeDays: log.activeDays + 1,
    streak,
    bestStreak: Math.max(log.bestStreak, streak.length),
  };
}

/**
 * The streak to show on `today`: alive while the last active day is today or yesterday ("active
 * yesterday or today"), and also when the clock went back to before it; 0 after a missed day.
 */
export function currentStreak(log: DayStreak<unknown>, today: DateKey): number {
  const { lastDate, length } = log.streak;
  if (lastDate === null) return 0;
  return daysBetween(lastDate, today) <= 1 ? length : 0;
}

/** True when `today` already has its first result. */
export function isDayDone(log: DayStreak<unknown>, today: DateKey): boolean {
  return Object.hasOwn(log.byDay, today);
}

/** The last `count` days ending with `today`, oldest first, each with whether it was active. */
export function recentDays(
  log: DayStreak<unknown>,
  today: DateKey,
  count: number,
): readonly { readonly date: DateKey; readonly isDone: boolean }[] {
  return Array.from({ length: count }, (_, index) => {
    const date = addDays(today, index - count + 1);
    return { date, isDone: Object.hasOwn(log.byDay, date) };
  });
}

/**
 * Derives the streak from every active day the app keeps (any order, repeats allowed). Use it when
 * the history is kept forever; it agrees with recording the same days in order with recordDay.
 */
export function streakOfDays(days: readonly DateKey[]): DerivedStreak {
  const distinct = [...new Set(days)].sort();
  let streak: StreakRun = { lastDate: null, length: 0 };
  let bestStreak = 0;
  for (const date of distinct) {
    streak = extend(streak, date);
    bestStreak = Math.max(bestStreak, streak.length);
  }
  return { activeDays: distinct.length, streak, bestStreak };
}
