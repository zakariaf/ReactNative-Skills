// src/services/local-notifications/fake-local-notifications.ts
import { err, ok } from '@/core/result';

import type { PlannedNotification } from '@/core/reminders/plan-reminders';
import type {
  LocalNotificationsPort,
  NamedChannel,
  NotificationPermission,
  NotificationTap,
  ScheduleFailure,
} from '@/services/local-notifications/local-notifications-port';

export type FakeLocalNotificationsOptions = {
  /** What permission() reads; default 'granted'. */
  readonly permission?: NotificationPermission;
  /** What the system prompt answers; default 'granted'. */
  readonly answer?: NotificationPermission;
  /** Identifiers already pending (another feature's, or a previous sync's). */
  readonly pendingIds?: readonly string[];
  /** Notifications the OS refuses to schedule, by identifier. */
  readonly refuse?: readonly string[];
  /** True to make pendingIds() fail, as a busy notification centre does. */
  readonly isPendingReadBroken?: boolean;
};

type Counts = {
  readonly schedule: number;
  readonly cancel: number;
  readonly prompts: number;
  readonly channelSyncs: number;
};

/** An in-memory LocalNotificationsPort with counters and a way to tap a notification. */
export type FakeLocalNotifications = LocalNotificationsPort & {
  /** The pending notifications by identifier (foreign identifiers hold null). */
  readonly pending: () => ReadonlyMap<string, PlannedNotification | null>;
  readonly channels: () => readonly NamedChannel[];
  readonly calls: () => Readonly<Counts>;
  /** Delivers a tap to the listeners and makes it the last tap. */
  readonly tap: (tap: NotificationTap) => void;
  /** Changes what permission() reads, as the person does in the system Settings. */
  readonly setPermission: (permission: NotificationPermission) => void;
};

type Scheduler = Pick<
  FakeLocalNotifications,
  'pendingIds' | 'scheduleNotifications' | 'cancelNotifications' | 'pending'
> & { readonly counts: () => Pick<Counts, 'schedule' | 'cancel'> };

/** The pending set: scheduling, cancelling and reading identifiers. */
function createScheduler(options: FakeLocalNotificationsOptions): Scheduler {
  let scheduleCalls = 0;
  let cancelCalls = 0;
  const pending = new Map<string, PlannedNotification | null>(
    (options.pendingIds ?? []).map((id) => [id, null]),
  );
  const refused = new Set(options.refuse ?? []);
  const schedule = (notification: PlannedNotification): ScheduleFailure | null => {
    if (refused.has(notification.id)) {
      return { id: notification.id, failure: { kind: 'os-refused', detail: 'refused' } };
    }
    pending.set(notification.id, notification);
    return null;
  };
  return {
    pendingIds: () =>
      Promise.resolve(
        options.isPendingReadBroken === true
          ? err({ kind: 'os-refused', detail: 'pending read refused' })
          : ok([...pending.keys()]),
      ),
    scheduleNotifications: (notifications) => {
      scheduleCalls += 1;
      return Promise.resolve(notifications.map(schedule).filter((failure) => failure !== null));
    },
    cancelNotifications: (ids) => {
      cancelCalls += 1;
      for (const id of ids) pending.delete(id);
      return Promise.resolve();
    },
    pending: () => new Map(pending),
    counts: () => ({ schedule: scheduleCalls, cancel: cancelCalls }),
  };
}

type Taps = Pick<FakeLocalNotifications, 'lastTap' | 'clearLastTap' | 'onTap' | 'tap'>;

/** The last tap and the tap listeners. */
function createTaps(): Taps {
  const listeners = new Set<(tap: NotificationTap) => void>();
  let last: NotificationTap | null = null;
  return {
    lastTap: () => last,
    clearLastTap: () => {
      last = null;
    },
    onTap: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    tap: (tap) => {
      last = tap;
      for (const listener of listeners) listener(tap);
    },
  };
}

export function createFakeLocalNotifications(
  options: FakeLocalNotificationsOptions = {},
): FakeLocalNotifications {
  let permission = options.permission ?? 'granted';
  let channels: readonly NamedChannel[] = [];
  let prompts = 0;
  let channelSyncs = 0;
  const { counts, ...scheduler } = createScheduler(options);
  return {
    ...scheduler,
    ...createTaps(),
    permission: () => Promise.resolve(permission),
    requestPermission: () => {
      prompts += 1;
      permission = options.answer ?? 'granted';
      return Promise.resolve(permission);
    },
    syncChannels: (next) => {
      channelSyncs += 1;
      channels = next;
      return Promise.resolve();
    },
    channels: () => channels,
    calls: () => ({ ...counts(), prompts, channelSyncs }),
    setPermission: (next) => {
      permission = next;
    },
  };
}
