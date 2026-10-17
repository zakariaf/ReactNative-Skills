// src/services/local-notifications/local-notifications-port.ts
// The LocalNotificationsPort: what the reminder sync and the tap handler need from the phone's
// notification centre (expo-notifications: UNUserNotificationCenter on iOS, AlarmManager and
// NotificationManager on Android) and nothing more. Expected failures are values; nothing here
// rejects. Only reminder-sync.ts calls scheduleNotifications and cancelNotifications.
// Adapter: expo-local-notifications-adapter.ts. Fake: fake-local-notifications.ts.
import type { PlannedNotification } from '@/core/reminders/plan-reminders';
import type { Result } from '@/core/result';

/**
 * The notification permission as the app acts on it (the same five states as push-notifications'
 * PushPermission, a subset of permissions-and-system-prompts' PermissionState, so this port is a
 * PermissionAccess for the `notifications` kind):
 * - granted: alerts allowed;
 * - provisional: iOS delivers quietly to Notification Center without having asked (counts as allowed);
 * - undetermined: never asked, so the system prompt can still appear;
 * - denied: refused, but Android 13+ may still show the prompt once more;
 * - blocked: the prompt will never appear again; only the system Settings can turn it on.
 */
export type NotificationPermission =
  'granted' | 'provisional' | 'undetermined' | 'denied' | 'blocked';

/** True when scheduled notifications will be shown (loudly, or quietly on iOS). */
export function isNotificationAllowed(permission: NotificationPermission): boolean {
  return permission === 'granted' || permission === 'provisional';
}

/** An Android notification channel, with its texts already in the person's language. */
export type NamedChannel = {
  /** Stable forever: Android keeps the person's settings under this id. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Fixed at creation: Android lets an app change only the name and description afterwards. */
  readonly importance: 'high' | 'default' | 'low';
};

/** Why the OS could not be read or refused a request. */
export type LocalNotificationsFailure = {
  readonly kind: 'os-refused';
  /** The SDK's message, for the error log only (never shown to the person). */
  readonly detail: string;
};

/** A notification the OS refused to schedule; the others in the same call still went through. */
export type ScheduleFailure = { readonly id: string; readonly failure: LocalNotificationsFailure };

/** A person's tap on a notification (or one of its action buttons). */
export type NotificationTap = {
  /** The notification's identifier: the same tap can arrive twice (the launch read and the listener). */
  readonly id: string;
  /** 'open' for a tap on the notification itself, else the action button's identifier. */
  readonly action: string;
  /** The notification's custom data, unchecked: parse it (parseReminderTap) before acting on it. */
  readonly data: unknown;
};

export type Unsubscribe = () => void;

/**
 * The notification centre as reminders use it: reads and requests the permission, keeps the Android
 * channels, lists, schedules and cancels pending notifications by identifier, and reports taps. Its
 * members never reject: failures come back as values or are recorded by the adapter.
 */
export type LocalNotificationsPort = {
  /** Reads the permission; never shows a prompt. */
  readonly permission: () => Promise<NotificationPermission>;
  /**
   * Shows the system prompt when the OS still allows one and resolves with the outcome. Only ever
   * called from a person's action, after the app said why, and after syncChannels (an app
   * targeting Android 12L or lower gets no prompt before a channel exists).
   */
  readonly requestPermission: () => Promise<NotificationPermission>;
  /** Creates or renames the Android channels; resolves at once on iOS. Idempotent. */
  readonly syncChannels: (channels: readonly NamedChannel[]) => Promise<void>;
  /** The identifiers of every pending scheduled notification, this app's other features' included. */
  readonly pendingIds: () => Promise<Result<readonly string[], LocalNotificationsFailure>>;
  /** Schedules each notification at its instant, on its channel; resolves with the refusals. */
  readonly scheduleNotifications: (
    notifications: readonly PlannedNotification[],
  ) => Promise<readonly ScheduleFailure[]>;
  /** Cancels pending notifications by identifier; an unknown identifier is not an error. */
  readonly cancelNotifications: (ids: readonly string[]) => Promise<void>;
  /** The tap that launched or last resumed the app, or null. */
  readonly lastTap: () => NotificationTap | null;
  /** Forgets the last tap once handled, so a remount does not open it again. */
  readonly clearLastTap: () => void;
  /** Calls `listener` for every tap while the app runs (in the background or the foreground). */
  readonly onTap: (listener: (tap: NotificationTap) => void) => Unsubscribe;
};
