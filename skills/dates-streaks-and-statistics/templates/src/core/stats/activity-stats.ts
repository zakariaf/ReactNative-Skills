// src/core/stats/activity-stats.ts
// Pure statistics of a repeated activity (tasks completed, sessions finished): totals, successes and
// failures, time spent, the run of consecutive successes, per-day buckets for a fixed window, the
// best day ever, and custom counters folded by 'sum' or 'max'. Everything the window prunes away
// is kept as a counter, so no total ever shrinks.
import { daysBetween } from '@/core/dates/date-key';

import type { DateKey } from '@/core/dates/date-key';

/** Per-day buckets kept, counted back from the newest bucket (a 7-day chart needs 7). */
export const STATS_KEEP_DAYS = 14;

/** How a counter folds across events: a running total, or the best single event. */
export type CounterAggregate = 'sum' | 'max';

/** One counter's value measured over one event. */
export type CounterValue = { readonly value: number; readonly aggregate: CounterAggregate };

/**
 * A custom counter. `id` is kebab-case and a stored key: renaming it is a data migration, never an
 * edit. `measure` reads one committed step of the event (undone steps are not in the final log).
 */
export type CounterSpec<TStep> = {
  readonly id: string;
  readonly aggregate: CounterAggregate;
  readonly measure: (step: TStep) => number;
};

/** One local day's bucket. */
export type DayBucket = { readonly count: number; readonly durationMs: number };

/** The stored statistics section. */
export type ActivityStats = {
  readonly total: number;
  readonly successes: number;
  readonly failures: number;
  readonly durationMs: number;
  /** Consecutive successes up to the latest event; any failure resets it. */
  readonly currentRun: number;
  readonly longestRun: number;
  /** The day with the most events ever, kept after its bucket is pruned (ties: the earlier day). */
  readonly bestDay: { readonly date: DateKey; readonly count: number } | null;
  /** Events per local day for the last STATS_KEEP_DAYS days. */
  readonly perDay: Readonly<Record<DateKey, DayBucket>>;
  /** Counter id -> folded value. */
  readonly counters: Readonly<Record<string, number>>;
};

/** One finished event, as its caller measured it. */
export type ActivityEvent = {
  readonly isSuccess: boolean;
  readonly durationMs: number;
  readonly counters: Readonly<Record<string, CounterValue>>;
};

/** A new user's statistics, and what "Reset statistics" writes. */
export const EMPTY_ACTIVITY_STATS: ActivityStats = Object.freeze({
  total: 0,
  successes: 0,
  failures: 0,
  durationMs: 0,
  currentRun: 0,
  longestRun: 0,
  bestDay: null,
  perDay: Object.freeze({}),
  counters: Object.freeze({}),
});

/** Measures every counter over the committed steps of one event: 'sum' adds, 'max' keeps the largest. */
export function measureCounters<TStep>(
  specs: readonly CounterSpec<TStep>[],
  steps: readonly TStep[],
): Readonly<Record<string, CounterValue>> {
  const result: Record<string, CounterValue> = {};
  for (const spec of specs) {
    const values = steps.map((step) => spec.measure(step));
    const value =
      spec.aggregate === 'sum'
        ? values.reduce((total, next) => total + next, 0)
        : Math.max(0, ...values);
    result[spec.id] = { value, aggregate: spec.aggregate };
  }
  return result;
}

function foldCounters(
  current: Readonly<Record<string, number>>,
  measured: Readonly<Record<string, CounterValue>>,
): Readonly<Record<string, number>> {
  const next: Record<string, number> = { ...current };
  for (const [id, { value, aggregate }] of Object.entries(measured)) {
    const previous = next[id] ?? 0;
    next[id] = aggregate === 'sum' ? previous + value : Math.max(previous, value);
  }
  return next;
}

function newestOf(perDay: Readonly<Record<DateKey, DayBucket>>, day: DateKey): DateKey {
  return Object.keys(perDay).reduce((newest, date) => (date > newest ? date : newest), day);
}

function addToDay(
  perDay: Readonly<Record<DateKey, DayBucket>>,
  day: DateKey,
  durationMs: number,
): Readonly<Record<DateKey, DayBucket>> {
  const newest = newestOf(perDay, day);
  const isKept = (date: DateKey): boolean => daysBetween(date, newest) < STATS_KEEP_DAYS;
  if (!isKept(day)) return perDay;
  const bucket = perDay[day] ?? { count: 0, durationMs: 0 };
  const merged = {
    ...perDay,
    [day]: { count: bucket.count + 1, durationMs: bucket.durationMs + durationMs },
  };
  return Object.fromEntries(Object.entries(merged).filter(([date]) => isKept(date)));
}

function bestDayAfter(stats: ActivityStats, day: DateKey, count: number): ActivityStats['bestDay'] {
  if (count === 0) return stats.bestDay; // the event's day is older than the kept window
  return stats.bestDay === null || count > stats.bestDay.count
    ? { date: day, count }
    : stats.bestDay;
}

/** Folds one finished event into the statistics, under the local day the event started. */
export function recordActivity(
  stats: ActivityStats,
  event: ActivityEvent,
  day: DateKey,
): ActivityStats {
  const currentRun = event.isSuccess ? stats.currentRun + 1 : 0;
  const perDay = addToDay(stats.perDay, day, event.durationMs);
  return {
    total: stats.total + 1,
    successes: stats.successes + (event.isSuccess ? 1 : 0),
    failures: stats.failures + (event.isSuccess ? 0 : 1),
    durationMs: stats.durationMs + event.durationMs,
    currentRun,
    longestRun: Math.max(stats.longestRun, currentRun),
    bestDay: bestDayAfter(stats, day, perDay[day]?.count ?? 0),
    perDay,
    counters: foldCounters(stats.counters, event.counters),
  };
}
