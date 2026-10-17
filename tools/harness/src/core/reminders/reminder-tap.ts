// src/core/reminders/reminder-tap.ts
// What a reminder notification carries in its data, and the check a tap runs before acting on it.
// The data names the reminder row and nothing else: no path, no title, no URL. A notification can
// outlive the code that scheduled it (an app update renames a route, the person deletes the task),
// so a tap reads the row again and opens what the database says now. Data from the OS is untrusted
// input: a push, another feature's notification or an older build's shape all arrive in the same
// listener, so anything that is not exactly a reminder tap is ignored here.
import { isReminderId } from './reminder';

/** The `kind` value reminder notifications use; other notification sources never use it. */
export const REMINDER_TAP_KIND = 'reminder';

/** The custom data of a reminder notification. */
export type ReminderTapData = {
  readonly kind: typeof REMINDER_TAP_KIND;
  readonly reminderId: string;
};

/** The data to attach to a notification of `reminderId`. */
export function reminderTapData(reminderId: string): ReminderTapData {
  return { kind: REMINDER_TAP_KIND, reminderId };
}

/** The reminder id a tapped notification names, or null when the data is not a reminder tap. */
export function parseReminderTap(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  if (!('kind' in data) || !('reminderId' in data)) return null;
  const { kind, reminderId } = data;
  if (kind !== REMINDER_TAP_KIND || typeof reminderId !== 'string') return null;
  return isReminderId(reminderId) ? reminderId : null;
}
