// src/core/reminders/reconcile-reminders.ts
// The diff between the plan and what the OS has pending: which identifiers to cancel and which
// notifications to schedule. Identifiers encode the reminder, the instant and the content, so an
// unchanged plan is an empty diff and an edited reminder is one cancel plus one schedule. Only the
// planner's own identifiers (REMINDER_ID_PREFIX) are ever cancelled: another feature's pending
// notifications are not this sync's to touch. Reading the pending identifiers (never their fire
// dates) is enough: iOS reports a date trigger as a time interval from when it was scheduled.
// A pending identifier the planner reports as imminent (due within the lead, too close to schedule
// again) is kept: cancelling it a few seconds before it fires would lose that occurrence.
import { REMINDER_ID_PREFIX } from './plan-reminders';

import type { PlannedNotification } from './plan-reminders';

export type ReminderDiff = {
  /** Pending reminder identifiers the plan no longer contains. */
  readonly cancel: readonly string[];
  /** Planned notifications not yet pending, nearest first. */
  readonly schedule: readonly PlannedNotification[];
};

/**
 * The cancel and schedule lists that turn `pendingIds` into `planned`. `keepIds` (the plan's
 * imminentIds) are never cancelled. Pure.
 */
export function reconcileReminders(
  planned: readonly PlannedNotification[],
  pendingIds: readonly string[],
  keepIds: readonly string[] = [],
): ReminderDiff {
  const wanted = new Set([...planned.map((notification) => notification.id), ...keepIds]);
  const pending = new Set(pendingIds);
  const cancel = [...pending].filter((id) => id.startsWith(REMINDER_ID_PREFIX) && !wanted.has(id));
  const schedule = planned.filter((notification) => !pending.has(notification.id));
  return { cancel, schedule };
}
