// src/core/goals/score-day.ts
// The "after" of examples/splitting-a-long-function.md: one options object, lookup tables and small
// named steps instead of one 44-line function with nested conditions. The bands, the Premium bonus
// and the snooze cost are illustration values, not library rules.

export type GoalRule =
  | { readonly kind: 'count'; readonly target: number }
  | { readonly kind: 'focus'; readonly thresholds: readonly [number, number, number] };

export type Stars = 0 | 1 | 2 | 3;

export type DayResult = {
  readonly tasksDone: number;
  readonly focusMinutes: number;
  readonly isClosed: boolean;
};

export type ScoreDayOptions = {
  readonly result: DayResult;
  readonly goal: GoalRule;
  readonly isPremium: boolean;
  readonly snoozesUsed: number;
};

export type DayScore = { readonly stars: Stars; readonly points: number };

/** Points per star; in this illustration the Premium entitlement doubles them. */
const POINTS_PER_STAR = { regular: 100, premium: 200 } as const;
const SNOOZE_COST = 25;

/** Stars against a task-count goal: the target or more is 3, each band of two below drops one. */
export function starsByCount(tasksDone: number, target: number): Stars {
  if (tasksDone >= target) return 3;
  if (tasksDone >= target - 2) return 2;
  return 1;
}

const STARS_BY_THRESHOLDS_REACHED: readonly Stars[] = [0, 1, 2, 3];

/** Stars against focus thresholds: one star per threshold reached. */
export function starsByFocus(
  minutes: number,
  thresholds: readonly [number, number, number],
): Stars {
  const reached = thresholds.filter((threshold) => minutes >= threshold).length;
  return STARS_BY_THRESHOLDS_REACHED[reached] ?? 0;
}

function starsFor(result: DayResult, goal: GoalRule): Stars {
  if (!result.isClosed) return 0;
  switch (goal.kind) {
    case 'count':
      return starsByCount(result.tasksDone, goal.target);
    case 'focus':
      return starsByFocus(result.focusMinutes, goal.thresholds);
  }
}

/** Stars and points for a closed day; snoozes cost points but never stars. */
export function scoreDay(options: ScoreDayOptions): DayScore {
  const stars = starsFor(options.result, options.goal);
  const perStar = options.isPremium ? POINTS_PER_STAR.premium : POINTS_PER_STAR.regular;
  const points = Math.max(0, stars * perStar - options.snoozesUsed * SNOOZE_COST);
  return { stars, points };
}
