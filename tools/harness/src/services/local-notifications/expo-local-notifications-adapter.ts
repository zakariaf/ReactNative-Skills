// src/services/local-notifications/expo-local-notifications-adapter.ts
// The only file that schedules, lists or cancels local notifications through expo-notifications.
// Every notification is a one-shot DATE trigger at an instant the planner resolved (iOS turns it
// into a time interval from now, Android into an AlarmManager alarm: exact when the app holds the
// exact-alarm permission, inexact otherwise), on an explicit Android channel. SDK errors become
// values or error-log entries; nothing here rejects.
import {
  AndroidImportance,
  DEFAULT_ACTION_IDENTIFIER,
  IosAuthorizationStatus,
  PermissionStatus,
  SchedulableTriggerInputTypes,
  addNotificationResponseReceivedListener,
  cancelScheduledNotificationAsync,
  clearLastNotificationResponse,
  getAllScheduledNotificationsAsync,
  getLastNotificationResponse,
  getPermissionsAsync,
  requestPermissionsAsync,
  scheduleNotificationAsync,
  setNotificationChannelAsync,
  setNotificationHandler,
} from 'expo-notifications';

import { attemptAsync, err, ok } from '@/core/result';

import type { PlannedNotification } from '@/core/reminders/plan-reminders';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type {
  LocalNotificationsFailure,
  LocalNotificationsPort,
  NamedChannel,
  NotificationPermission,
  NotificationTap,
  ScheduleFailure,
} from '@/services/local-notifications/local-notifications-port';
import type {
  NotificationPermissionsStatus,
  NotificationRequestInput,
  NotificationResponse,
} from 'expo-notifications';

export type ExpoLocalNotificationsAdapterOptions = {
  readonly errorLog: ErrorLogPort;
  /**
   * True (the default) installs the app's one foreground handler. The composition root passes false
   * when push-notifications is adopted: its adapter owns the handler, and its policy covers local
   * notifications too. expo-notifications keeps one handler; a second call silently replaces it.
   */
  readonly installForegroundHandler?: boolean;
};

const IMPORTANCE: Readonly<Record<NamedChannel['importance'], AndroidImportance>> = {
  high: AndroidImportance.HIGH,
  default: AndroidImportance.DEFAULT,
  low: AndroidImportance.LOW,
};

const toFailure = (thrown: unknown): LocalNotificationsFailure => ({
  kind: 'os-refused',
  detail: thrown instanceof Error ? thrown.message : String(thrown),
});

/** The OS answer as the five states the app acts on (iOS reports the finer status under `ios`). */
export function toNotificationPermission(
  status: NotificationPermissionsStatus,
): NotificationPermission {
  const iosStatus = status.ios?.status;
  if (iosStatus === IosAuthorizationStatus.PROVISIONAL) return 'provisional';
  if (status.granted || iosStatus === IosAuthorizationStatus.EPHEMERAL) return 'granted';
  if (status.status === PermissionStatus.UNDETERMINED) return 'undetermined';
  return status.canAskAgain ? 'denied' : 'blocked';
}

function toTap(response: NotificationResponse): NotificationTap {
  const { request } = response.notification;
  const isOpen = response.actionIdentifier === DEFAULT_ACTION_IDENTIFIER;
  return {
    id: request.identifier,
    action: isOpen ? 'open' : response.actionIdentifier,
    data: request.content.data,
  };
}

/** Installs the app's one foreground handler (SDK 57 shows nothing in the foreground without it). */
function installForegroundHandler(): void {
  setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({
        shouldShowBanner: true,
        shouldShowList: true,
        // Android shows no heads-up banner without sound.
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
  });
}

async function readPermission(
  read: () => Promise<NotificationPermissionsStatus>,
  errorLog: ErrorLogPort,
): Promise<NotificationPermission> {
  const answer = await attemptAsync(read, toFailure);
  if (answer.ok) return toNotificationPermission(answer.value);
  errorLog.record('service', new Error(`notification permission: ${answer.error.detail}`));
  return 'undetermined';
}

async function syncChannels(
  channels: readonly NamedChannel[],
  errorLog: ErrorLogPort,
): Promise<void> {
  for (const channel of channels) {
    const set = await attemptAsync(
      () =>
        setNotificationChannelAsync(channel.id, {
          name: channel.name,
          description: channel.description,
          importance: IMPORTANCE[channel.importance],
        }),
      toFailure,
    );
    if (!set.ok)
      errorLog.record('service', new Error(`channel ${channel.id}: ${set.error.detail}`));
  }
}

/** The expo-notifications request of a planned notification: a one-shot date trigger on its channel. */
function requestOf(notification: PlannedNotification): NotificationRequestInput {
  return {
    identifier: notification.id,
    content: { title: notification.title, body: notification.body, data: { ...notification.data } },
    trigger: {
      type: SchedulableTriggerInputTypes.DATE,
      date: notification.fireAtMs,
      channelId: notification.channelId,
    },
  };
}

async function scheduleAll(
  notifications: readonly PlannedNotification[],
): Promise<readonly ScheduleFailure[]> {
  const failures: ScheduleFailure[] = [];
  // One at a time, nearest first: if the OS stops accepting, the soonest are already in.
  for (const notification of notifications) {
    const scheduled = await attemptAsync(
      () => scheduleNotificationAsync(requestOf(notification)),
      toFailure,
    );
    if (!scheduled.ok) failures.push({ id: notification.id, failure: scheduled.error });
  }
  return failures;
}

async function cancelAll(ids: readonly string[], errorLog: ErrorLogPort): Promise<void> {
  for (const id of ids) {
    const cancelled = await attemptAsync(() => cancelScheduledNotificationAsync(id), toFailure);
    if (!cancelled.ok)
      errorLog.record('service', new Error(`cancel ${id}: ${cancelled.error.detail}`));
  }
}

async function pendingIds(): ReturnType<LocalNotificationsPort['pendingIds']> {
  const pending = await attemptAsync(getAllScheduledNotificationsAsync, toFailure);
  return pending.ok ? ok(pending.value.map((request) => request.identifier)) : err(pending.error);
}

function onTap(listener: (tap: NotificationTap) => void): () => void {
  const subscription = addNotificationResponseReceivedListener((response) => {
    listener(toTap(response));
  });
  return () => {
    subscription.remove();
  };
}

/**
 * Creates the device LocalNotificationsPort. Called once, by the composition root. It installs the
 * app's one foreground handler unless `installForegroundHandler` is false (push-notifications'
 * adapter owns it then).
 */
export function createExpoLocalNotificationsAdapter({
  errorLog,
  installForegroundHandler: isHandlerOwner = true,
}: ExpoLocalNotificationsAdapterOptions): LocalNotificationsPort {
  if (isHandlerOwner) installForegroundHandler();
  return {
    permission: () => readPermission(getPermissionsAsync, errorLog),
    requestPermission: () =>
      readPermission(
        () => requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true } }),
        errorLog,
      ),
    syncChannels: (channels) => syncChannels(channels, errorLog),
    pendingIds,
    scheduleNotifications: scheduleAll,
    cancelNotifications: (ids) => cancelAll(ids, errorLog),
    lastTap: () => {
      const response = getLastNotificationResponse();
      return response === null ? null : toTap(response);
    },
    clearLastTap: () => {
      clearLastNotificationResponse();
    },
    onTap,
  };
}
