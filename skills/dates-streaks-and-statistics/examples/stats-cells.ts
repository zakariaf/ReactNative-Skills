// examples/stats-cells.ts — a shape to imitate (src/features/stats/stats-cells.ts in a Tasks app).
// Turns the pure statistics summary into the cells a statistics screen draws: each cell carries its
// testID, the message key of its label and its value in the form the screen formats it. Formatting
// happens in the view through the i18n layer: the rate as a bare percentage ("75%"), durations with a
// message ("2 h 14 min"), numbers in the locale's digits. A best-of counter ('max') reads as a record
// ("Longest checklist: 12"), a running total ('sum') as a plain count.

import type { StatsSummary } from '@/core/stats/stats-summary';

export type StatValue =
  | { readonly kind: 'count'; readonly value: number }
  /** A best-of counter ('max'): the record of a single task, never a running total. */
  | { readonly kind: 'record'; readonly value: number }
  /** A 0..1 share, shown as the bare percentage. */
  | { readonly kind: 'percent'; readonly rate: number }
  | { readonly kind: 'duration'; readonly hours: number; readonly minutes: number }
  | { readonly kind: 'days'; readonly daysCount: number }
  /** The best day, shown as "12 on 26 Sep" (formatDayMonth from src/i18n/format-date.ts). */
  | { readonly kind: 'best-day'; readonly count: number; readonly date: string };

export type StatCell = {
  /** The cell; its parts are `${testID}.value` and `${testID}.label`. */
  readonly testID: string;
  readonly labelKey: string;
  readonly value: StatValue;
};

/** A counter as the app declares it: its stored id, its label key and how it folds. */
export type CounterMeta = {
  readonly id: string;
  readonly labelKey: string;
  readonly aggregate: 'sum' | 'max';
};

const count = (value: number): StatValue => ({ kind: 'count', value });

/** The overview card: completed, on time, on-time rate, focus time. */
export function overviewCells(view: StatsSummary): readonly StatCell[] {
  const { total, successes, successRate, duration } = view.overview;
  return [
    { testID: 'stats.overview.completed', labelKey: 'stats.completed', value: count(total) },
    { testID: 'stats.overview.on-time', labelKey: 'stats.on-time', value: count(successes) },
    {
      testID: 'stats.overview.on-time-rate',
      labelKey: 'stats.on-time-rate',
      value: { kind: 'percent', rate: successRate },
    },
    {
      testID: 'stats.overview.focus-time',
      labelKey: 'stats.focus-time',
      value: { kind: 'duration', ...duration },
    },
  ];
}

/** The streak card, or no cells in an app without streaks. */
export function streakCells(view: StatsSummary): readonly StatCell[] {
  if (view.streak === null) return [];
  const { activeDays, current, best } = view.streak;
  return [
    {
      testID: 'stats.streak.current',
      labelKey: 'streak.current',
      value: { kind: 'days', daysCount: current },
    },
    {
      testID: 'stats.streak.best',
      labelKey: 'streak.best-label',
      value: { kind: 'days', daysCount: best },
    },
    {
      testID: 'stats.streak.active-days',
      labelKey: 'streak.active-days',
      value: count(activeDays),
    },
  ];
}

/** The records card: the longest on-time run and the best day (absent until the first task). */
export function recordCells(view: StatsSummary): readonly StatCell[] {
  const run: StatCell = {
    testID: 'stats.records.on-time-run',
    labelKey: 'stats.on-time-run',
    value: count(view.runs.longest),
  };
  if (view.bestDay === null) return [run];
  return [
    run,
    {
      testID: 'stats.records.best-day',
      labelKey: 'stats.best-day',
      value: { kind: 'best-day', ...view.bestDay },
    },
  ];
}

/** One cell per counter, in the order the app declares them. */
export function counterCells(
  view: StatsSummary,
  counters: readonly CounterMeta[],
): readonly StatCell[] {
  return counters.map((counter) => {
    const value = view.counters.find((each) => each.id === counter.id)?.value ?? 0;
    return {
      testID: `stats.counters.${counter.id}`,
      labelKey: counter.labelKey,
      value: counter.aggregate === 'max' ? { kind: 'record', value } : count(value),
    };
  });
}
