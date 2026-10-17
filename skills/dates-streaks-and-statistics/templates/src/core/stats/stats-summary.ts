// src/core/stats/stats-summary.ts
// Pure: the statistics section, the streak counts and today -> every number a statistics screen
// shows. Rates are 0..1 fractions and durations whole units; components format them (percent,
// digits, "2 h 14 min") through the i18n layer and never compute a number themselves. Nothing here
// imports src/core/streaks/, so an app with statistics and no streaks copies only this folder
// (record-completion.ts is the one file that needs both).
import { addDays, isoWeekday } from '@/core/dates/date-key';

import type { DateKey } from '@/core/dates/date-key';
import type { ActivityStats } from '@/core/stats/activity-stats';

/** Whole hours and the remaining whole minutes of a duration. */
export type Duration = { readonly hours: number; readonly minutes: number };

/**
 * The streak numbers the screen shows, from the stored counters (never the pruned window). An app
 * with streaks builds them with streakCountsOf(log, today) from src/core/streaks/streak-summary.ts.
 */
export type StreakCounts = {
  readonly activeDays: number;
  readonly current: number;
  readonly best: number;
};

/** What buildStatsSummary reads. */
export type StatsSummaryInput = {
  readonly stats: ActivityStats;
  /** The streak counts, or null in an app without streaks. */
  readonly streak: StreakCounts | null;
  readonly today: DateKey;
  /** The counters the screen shows, in its order; a counter never recorded reads 0. */
  readonly counterIds: readonly string[];
};

/** One bar of the seven-day chart. */
export type WeekBar = {
  readonly date: DateKey;
  /** ISO weekday 1..7 (1 = Monday): picks the weekday letter and the screen-reader name. */
  readonly weekday: number;
  readonly count: number;
};

/** Every number of the statistics screen. */
export type StatsSummary = {
  /** A new user sees the empty state, not a wall of zeros. */
  readonly isEmpty: boolean;
  readonly overview: {
    readonly total: number;
    readonly successes: number;
    /** 0..1; 0 before the first event. */
    readonly successRate: number;
    readonly duration: Duration;
  };
  readonly runs: { readonly current: number; readonly longest: number };
  readonly bestDay: { readonly date: DateKey; readonly count: number } | null;
  readonly streak: StreakCounts | null;
  /** The last seven local days, oldest first; `max` (at least 1) scales the bars. */
  readonly week: { readonly bars: readonly WeekBar[]; readonly max: number };
  readonly counters: readonly { readonly id: string; readonly value: number }[];
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const WEEK_DAYS = 7;

/** Splits milliseconds into whole hours and remaining whole minutes (8,040,000 -> 2 h 14 min). */
export function splitDuration(ms: number): Duration {
  const hours = Math.floor(ms / HOUR_MS);
  return { hours, minutes: Math.floor((ms - hours * HOUR_MS) / MINUTE_MS) };
}

/** A 0..1 share of `whole`, and 0 (never NaN) when `whole` is 0. */
export function rateOf(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

function weekOf(stats: ActivityStats, today: DateKey): StatsSummary['week'] {
  const bars = Array.from({ length: WEEK_DAYS }, (_, index): WeekBar => {
    const date = addDays(today, index - WEEK_DAYS + 1);
    return { date, weekday: isoWeekday(date), count: stats.perDay[date]?.count ?? 0 };
  });
  return { bars, max: Math.max(1, ...bars.map((bar) => bar.count)) };
}

/** Builds the statistics screen's model from the stored sections and today's key. */
export function buildStatsSummary(input: StatsSummaryInput): StatsSummary {
  const { stats, today } = input;
  return {
    isEmpty: stats.total === 0,
    overview: {
      total: stats.total,
      successes: stats.successes,
      successRate: rateOf(stats.successes, stats.total),
      duration: splitDuration(stats.durationMs),
    },
    runs: { current: stats.currentRun, longest: stats.longestRun },
    bestDay: stats.bestDay,
    streak: input.streak,
    week: weekOf(stats, today),
    counters: input.counterIds.map((id) => ({ id, value: stats.counters[id] ?? 0 })),
  };
}
