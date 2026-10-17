// src/core/stats/record-completion.ts
// Pure: one completion -> the streak section and the statistics section together. The caller writes
// the result in the same transaction as the completed row, before the confirmation shows, so the
// streak, the statistics and the history never disagree after a kill. This is the one file that
// needs both src/core/streaks/ and src/core/stats/; an app with statistics and no streaks calls
// recordActivity() directly in its handler instead.
import { EMPTY_ACTIVITY_STATS, recordActivity } from '@/core/stats/activity-stats';
import { EMPTY_DAY_STREAK, recordDay } from '@/core/streaks/day-streak';

import type { DateKey } from '@/core/dates/date-key';
import type { ActivityEvent, ActivityStats } from '@/core/stats/activity-stats';
import type { DayStreak } from '@/core/streaks/day-streak';

/** The two stored sections a completion changes. */
export type ActivityProgress<TDay> = {
  readonly streak: DayStreak<TDay>;
  readonly stats: ActivityStats;
};

/** One finished activity, measured by its caller. */
export type Completion<TDay> = {
  /** The local day the activity started (clock.today() when it began), never re-read at write time. */
  readonly day: DateKey;
  /** What the streak keeps for `day` when this is the day's first completion. */
  readonly dayResult: TDay;
  readonly event: ActivityEvent;
  /** A sample, a tutorial or a replay of an already-scored day: nothing is recorded. */
  readonly isPractice: boolean;
};

/** A new user's progress (assignable to any `ActivityProgress<TDay>`). */
export const EMPTY_ACTIVITY_PROGRESS: ActivityProgress<never> = Object.freeze({
  streak: EMPTY_DAY_STREAK,
  stats: EMPTY_ACTIVITY_STATS,
});

/**
 * Folds one completion into both sections. Practice returns `progress` itself; a repeat on an
 * already-active day counts in the statistics and leaves the streak section untouched.
 */
export function recordCompletion<TDay>(
  progress: ActivityProgress<TDay>,
  completion: Completion<TDay>,
): ActivityProgress<TDay> {
  if (completion.isPractice) return progress;
  return {
    streak: recordDay(progress.streak, completion.day, completion.dayResult),
    stats: recordActivity(progress.stats, completion.event, completion.day),
  };
}
