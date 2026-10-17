// src/core/reminders/reminder.ts
// What the database stores for one reminder, and the checks the planner runs before trusting a row.
// Pure TypeScript: no React, React Native or Expo. A recurring time is a wall-clock minute of the
// day plus a rule, never a UTC instant: "09:00 every day" must stay 09:00 across daylight saving
// changes and when the person travels. Only `at` holds an instant (a snooze, "in one hour").
import { isDateKey } from '@/core/dates/date-key';

import type { DateKey } from '@/core/dates/date-key';

/** Minutes in a civil day; a wall-clock time is 0..1439 (09:30 is 570). */
export const MINUTES_PER_DAY = 1440;

/** The longest label a notification carries; the rest of a long task title is cut. */
export const MAX_LABEL_LENGTH = 200;

/** When a reminder fires. Every kind except `at` is resolved through the local zone at sync time. */
export type ReminderSchedule =
  | { readonly kind: 'at'; readonly atMs: number }
  | { readonly kind: 'once'; readonly day: DateKey; readonly minuteOfDay: number }
  | { readonly kind: 'daily'; readonly minuteOfDay: number }
  | {
      readonly kind: 'weekly';
      /** ISO weekdays, 1 = Monday .. 7 = Sunday (isoWeekday in src/core/dates/date-key.ts). */
      readonly isoWeekdays: readonly number[];
      readonly minuteOfDay: number;
    };

/**
 * One active reminder as the repository returns it. The database is its source of truth. Where a
 * tap leads is not here: the app looks the row up again at tap time and maps its subject (a task)
 * to a typed route, so the planner never handles a path.
 */
export type Reminder = {
  /** The row's stable id as text: letters, digits, `_` and `-`, at most 64 characters. */
  readonly id: string;
  readonly schedule: ReminderSchedule;
  /** The Android channel the notification posts to (ignored on iOS); one of the declared channels. */
  readonly channelId: string;
  /** What the person wrote (a task title); the notification text quotes it. May be empty. */
  readonly label: string;
  /** Local days on which a day-based schedule stays silent (the task was done, a skipped day). */
  readonly skipDays: readonly DateKey[];
};

/** Why the planner refused a reminder row. */
export type ReminderProblem =
  'id' | 'channel' | 'label' | 'minute-of-day' | 'day' | 'weekdays' | 'instant';

const ID_PATTERN = /^[\w-]{1,64}$/;

/** True for a whole minute of a civil day, 0..1439. */
export function isMinuteOfDay(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < MINUTES_PER_DAY;
}

/** True for a reminder or notification id: letters, digits, `_` and `-`, 1 to 64 characters. */
export function isReminderId(value: string): boolean {
  return ID_PATTERN.test(value);
}

const isIsoWeekday = (day: number): boolean => Number.isInteger(day) && day >= 1 && day <= 7;

function scheduleProblem(schedule: ReminderSchedule): ReminderProblem | null {
  if (schedule.kind === 'at') return Number.isSafeInteger(schedule.atMs) ? null : 'instant';
  if (schedule.kind === 'once' && !isDateKey(schedule.day)) return 'day';
  if (
    schedule.kind === 'weekly' &&
    (schedule.isoWeekdays.length === 0 || !schedule.isoWeekdays.every(isIsoWeekday))
  ) {
    return 'weekdays';
  }
  return isMinuteOfDay(schedule.minuteOfDay) ? null : 'minute-of-day';
}

/** The first problem of a row, or null when the planner can use it. */
export function reminderProblem(reminder: Reminder): ReminderProblem | null {
  if (!isReminderId(reminder.id)) return 'id';
  if (reminder.channelId.length === 0) return 'channel';
  if (reminder.label.length > MAX_LABEL_LENGTH) return 'label';
  return scheduleProblem(reminder.schedule);
}
