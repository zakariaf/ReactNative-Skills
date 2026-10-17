// src/core/reminders/plan-reminders.ts
// The pure planner: from the reminders the database holds, the notifications the OS should have
// pending right now. Each occurrence becomes one one-shot notification at an instant resolved
// through the local zone, with an identifier that names the reminder, the instant and the
// content, so the same input always plans the same identifiers (the sync is a no-op) and an edit
// plans new ones (the sync cancels the old and schedules the new). Only the nearest `maxPending`
// occurrences are kept: iOS keeps 64 pending notifications per app and silently drops the rest.
import { addDays, isoWeekday } from '@/core/dates/date-key';

import { reminderProblem } from './reminder';
import { reminderTapData } from './reminder-tap';
import { instantOfWallClock } from './wall-clock';

import type { Reminder, ReminderProblem } from './reminder';
import type { ReminderTapData } from './reminder-tap';
import type { OffsetAt } from './wall-clock';
import type { DateKey } from '@/core/dates/date-key';

/** Every identifier the planner makes starts with this; the sync touches no other pending one. */
export const REMINDER_ID_PREFIX = 'reminder:';
/** Pending local notifications iOS keeps per app (the soonest 64; the rest never fire). */
export const IOS_PENDING_LIMIT = 64;
/** The default plan size: headroom under the iOS limit for the app's other local notifications. */
export const DEFAULT_MAX_PENDING = 50;
/** How far ahead a daily or weekly reminder is expanded before maxPending cuts it. */
export const DEFAULT_HORIZON_DAYS = 30;
/**
 * An occurrence closer than this is never scheduled: iOS rejects a trigger in the past, Android drops
 * it silently. One that is already pending is kept (PlanResult.imminentIds), not cancelled.
 */
export const DEFAULT_MIN_LEAD_MS = 5000;

/** The text of one notification, already in the app's language. */
export type NotificationText = { readonly title: string; readonly body: string };

/** One occurrence of a reminder; `day` is the local day for day-based schedules, else null. */
export type Occurrence = {
  readonly reminder: Reminder;
  readonly fireAtMs: number;
  readonly day: DateKey | null;
};

export type PlanInput = {
  readonly reminders: readonly Reminder[];
  /** ClockPort.nowMs() at the start of the sync. */
  readonly nowMs: number;
  /** ClockPort.today() at the start of the sync. */
  readonly today: DateKey;
  /** LocalZonePort.offsetAt. */
  readonly offsetAt: OffsetAt;
  /** The Android channel ids the app creates; a row naming another channel is rejected. */
  readonly channelIds: readonly string[];
  /** The localized title and body of an occurrence (a t() call; never a hard-coded string). */
  readonly describe: (occurrence: Occurrence) => NotificationText;
  /** At most IOS_PENDING_LIMIT; default DEFAULT_MAX_PENDING. */
  readonly maxPending?: number;
  readonly horizonDays?: number;
  readonly minLeadMs?: number;
};

/** One notification the OS should have pending. */
export type PlannedNotification = {
  readonly id: string;
  readonly reminderId: string;
  readonly fireAtMs: number;
  readonly channelId: string;
  readonly title: string;
  readonly body: string;
  readonly data: ReminderTapData;
};

export type RejectedReminder = { readonly reminderId: string; readonly problem: ReminderProblem };

export type PlanResult = {
  /** Nearest first, at most `maxPending` long. */
  readonly notifications: readonly PlannedNotification[];
  /**
   * Identifiers of occurrences due within the lead (now <= instant < now + minLeadMs). They are too
   * close to schedule, but one the OS already holds is about to fire: reconcileReminders keeps it
   * instead of cancelling it. A deleted or edited reminder plans no such identifier, so its pending
   * notification is still cancelled.
   */
  readonly imminentIds: readonly string[];
  /** Rows the planner could not use: the sync records them, the database keeps them. */
  readonly rejected: readonly RejectedReminder[];
};

type Window = {
  readonly today: DateKey;
  /** Occurrences before this instant are over; from here to earliestMs they are imminent. */
  readonly nowMs: number;
  readonly earliestMs: number;
  readonly horizonDays: number;
  readonly limit: number;
  readonly offsetAt: OffsetAt;
};

/** 32-bit FNV-1a in base 36: a short, stable fingerprint of the notification's content. */
function contentHash(text: string): string {
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01_00_01_93);
  }
  return (hash >>> 0).toString(36);
}

/** True when a day-based reminder stays silent on `day`: a skip day, or not one of its weekdays. */
function isSilentOn(
  day: DateKey,
  skip: ReadonlySet<string>,
  weekdays: ReadonlySet<number> | null,
): boolean {
  return skip.has(day) || (weekdays !== null && !weekdays.has(isoWeekday(day)));
}

/**
 * The day-based occurrences of a daily or weekly reminder from now on (imminent ones included),
 * nearest first; at most `limit` of them are far enough ahead to schedule.
 */
function dayOccurrences(reminder: Reminder, window: Window): Occurrence[] {
  const { schedule } = reminder;
  if (schedule.kind !== 'daily' && schedule.kind !== 'weekly') return [];
  const weekdays = schedule.kind === 'weekly' ? new Set(schedule.isoWeekdays) : null;
  const skip = new Set(reminder.skipDays);
  const found: Occurrence[] = [];
  let ahead = 0;
  for (let offset = 0; offset < window.horizonDays && ahead < window.limit; offset += 1) {
    const day = addDays(window.today, offset);
    if (isSilentOn(day, skip, weekdays)) continue;
    const fireAtMs = instantOfWallClock(day, schedule.minuteOfDay, window.offsetAt);
    if (fireAtMs < window.nowMs) continue;
    found.push({ reminder, fireAtMs, day });
    if (fireAtMs >= window.earliestMs) ahead += 1;
  }
  return found;
}

/** Every occurrence of a reminder from now on, imminent ones included. */
function occurrencesOf(reminder: Reminder, window: Window): Occurrence[] {
  const { schedule } = reminder;
  if (schedule.kind === 'at') {
    return schedule.atMs >= window.nowMs ? [{ reminder, fireAtMs: schedule.atMs, day: null }] : [];
  }
  if (schedule.kind === 'once') {
    if (reminder.skipDays.includes(schedule.day)) return [];
    const fireAtMs = instantOfWallClock(schedule.day, schedule.minuteOfDay, window.offsetAt);
    return fireAtMs >= window.nowMs ? [{ reminder, fireAtMs, day: schedule.day }] : [];
  }
  return dayOccurrences(reminder, window);
}

function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function maxPendingOf(input: PlanInput): number {
  const maxPending = input.maxPending ?? DEFAULT_MAX_PENDING;
  if (!Number.isInteger(maxPending) || maxPending < 0 || maxPending > IOS_PENDING_LIMIT) {
    throw new RangeError(`maxPending must be a whole number 0..${String(IOS_PENDING_LIMIT)}`);
  }
  return maxPending;
}

function toPlanned(occurrence: Occurrence, text: NotificationText): PlannedNotification {
  const { reminder, fireAtMs } = occurrence;
  const fingerprint = contentHash([reminder.channelId, text.title, text.body].join('\n'));
  return {
    id: `${REMINDER_ID_PREFIX}${reminder.id}:${fireAtMs.toString(36)}:${fingerprint}`,
    reminderId: reminder.id,
    fireAtMs,
    channelId: reminder.channelId,
    title: text.title,
    body: text.body,
    data: reminderTapData(reminder.id),
  };
}

/** Plans the pending notifications for `input.reminders`: pure, deterministic, nearest first. */
export function planReminders(input: PlanInput): PlanResult {
  const limit = maxPendingOf(input);
  const window: Window = {
    today: input.today,
    nowMs: input.nowMs,
    earliestMs: input.nowMs + (input.minLeadMs ?? DEFAULT_MIN_LEAD_MS),
    horizonDays: input.horizonDays ?? DEFAULT_HORIZON_DAYS,
    limit,
    offsetAt: input.offsetAt,
  };
  const channels = new Set(input.channelIds);
  const rejected: RejectedReminder[] = [];
  const occurrences: Occurrence[] = [];
  for (const reminder of input.reminders) {
    const problem = channels.has(reminder.channelId) ? reminderProblem(reminder) : 'channel';
    if (problem === null) occurrences.push(...occurrencesOf(reminder, window));
    else rejected.push({ reminderId: reminder.id, problem });
  }
  // Code-unit order for ties: the same on every engine, unlike localeCompare.
  occurrences.sort((a, b) =>
    a.fireAtMs === b.fireAtMs ? compareIds(a.reminder.id, b.reminder.id) : a.fireAtMs - b.fireAtMs,
  );
  const seen = new Set<string>();
  const notifications: PlannedNotification[] = [];
  const imminentIds: string[] = [];
  for (const occurrence of occurrences) {
    if (notifications.length >= limit) break;
    const planned = toPlanned(occurrence, input.describe(occurrence));
    if (seen.has(planned.id)) continue;
    seen.add(planned.id);
    if (occurrence.fireAtMs < window.earliestMs) imminentIds.push(planned.id);
    else notifications.push(planned);
  }
  return { notifications, imminentIds, rejected };
}
