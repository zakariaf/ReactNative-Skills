// src/hooks/use-reminder-taps.ts
// Opens the reminder a person tapped: the tap that launched the app (read once on mount) and every
// later tap (the listener). Both can report the same tap, so each notification id is handled once,
// and the launch tap is cleared after use so a remount does not open it again. Data that is not a
// reminder tap is left alone: push notifications and other features read the same events.
import { useEffect } from 'react';

import { parseReminderTap } from '@/core/reminders/reminder-tap';

import type {
  LocalNotificationsPort,
  NotificationTap,
} from '@/services/local-notifications/local-notifications-port';

/**
 * Mount once, inside the navigator (a group layout), so `openReminder` can navigate on a cold start.
 * `openReminder` reads the row again and opens the typed route of its subject (the task), or the
 * home screen when the row is gone.
 */
export function useReminderTaps(
  notifications: LocalNotificationsPort,
  openReminder: (reminderId: string) => void,
): void {
  useEffect(() => {
    const handled = new Set<string>();
    const handle = (tap: NotificationTap): void => {
      const reminderId = parseReminderTap(tap.data);
      if (reminderId === null) return;
      // Cleared for a repeat too: the OS stores every response it delivers as the last one, so the
      // listener's copy of the launch tap sets it again, and a remount would open the reminder twice.
      notifications.clearLastTap();
      if (tap.action !== 'open' || handled.has(tap.id)) return;
      handled.add(tap.id);
      openReminder(reminderId);
    };
    const launchTap = notifications.lastTap();
    if (launchTap !== null) handle(launchTap);
    return notifications.onTap(handle);
  }, [notifications, openReminder]);
}
