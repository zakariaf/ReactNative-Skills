// src/services/local-notifications/expo-local-notifications-adapter.test.ts
// Drives the adapter against Jest's automock of expo-notifications (read with a typed requireMock).
// The automock keeps the SDK's enum values (AndroidImportance.HIGH is 6, not 4). The test reaches
// the SDK only through jest.mock and a typed requireMock: only an adapter may import
// expo-notifications, types included (the canonical ESLint vendor ban).
import { planReminders } from '@/core/reminders/plan-reminders';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { planInput } from '@test/reminders/reminder-rows';

import {
  createExpoLocalNotificationsAdapter,
  toNotificationPermission,
} from './expo-local-notifications-adapter';

jest.mock('expo-notifications');

type Handler = {
  readonly handleNotification: () => Promise<Record<string, boolean>>;
};
type Response = {
  readonly actionIdentifier: string;
  readonly notification: {
    readonly request: { readonly identifier: string; readonly content: { readonly data: unknown } };
  };
};
/** The OS permission answer, as the adapter's mapper takes it. */
type Answer = Parameters<typeof toNotificationPermission>[0];
type IosPermission = NonNullable<Answer['ios']>;
type MockedNotifications = {
  readonly DEFAULT_ACTION_IDENTIFIER: string;
  readonly PermissionStatus: Readonly<
    Record<'GRANTED' | 'DENIED' | 'UNDETERMINED', Answer['status']>
  >;
  readonly IosAuthorizationStatus: Readonly<
    Record<'PROVISIONAL' | 'EPHEMERAL', IosPermission['status']>
  >;
  readonly AndroidImportance: Readonly<Record<'HIGH' | 'LOW', number>>;
  readonly setNotificationHandler: jest.Mock<undefined, [Handler]>;
  readonly getPermissionsAsync: jest.Mock<Promise<Answer>>;
  readonly requestPermissionsAsync: jest.Mock<Promise<Answer>>;
  readonly setNotificationChannelAsync: jest.Mock<Promise<null>, [string, object]>;
  readonly getAllScheduledNotificationsAsync: jest.Mock<
    Promise<readonly { readonly identifier: string }[]>
  >;
  readonly scheduleNotificationAsync: jest.Mock<Promise<string>, [object]>;
  readonly cancelScheduledNotificationAsync: jest.Mock<Promise<undefined>, [string]>;
  readonly getLastNotificationResponse: jest.Mock<Response | null>;
  readonly clearLastNotificationResponse: jest.Mock<undefined>;
  readonly addNotificationResponseReceivedListener: jest.Mock<
    { readonly remove: () => void },
    [(response: Response) => void]
  >;
};

const native = jest.requireMock<MockedNotifications>('expo-notifications');
const plan = planReminders(planInput({ horizonDays: 2 })).notifications;

const { AndroidImportance, IosAuthorizationStatus, PermissionStatus } = native;
const iosStatus = (value: IosPermission['status']): IosPermission =>
  ({ status: value }) as IosPermission;

function status(fields: Partial<Answer>): Answer {
  return {
    status: PermissionStatus.DENIED,
    granted: false,
    canAskAgain: true,
    expires: 'never',
    ...fields,
  };
}

function response(actionIdentifier: string): Response {
  return {
    actionIdentifier,
    notification: {
      request: { identifier: 'reminder:task-42:x:y', content: { data: { kind: 'reminder' } } },
    },
  };
}

function createAdapter(shouldInstallHandler?: boolean): {
  readonly adapter: ReturnType<typeof createExpoLocalNotificationsAdapter>;
  readonly errorLog: ReturnType<typeof createFakeErrorLog>;
} {
  const errorLog = createFakeErrorLog();
  const adapter = createExpoLocalNotificationsAdapter(
    shouldInstallHandler === undefined
      ? { errorLog }
      : { errorLog, installForegroundHandler: shouldInstallHandler },
  );
  return { adapter, errorLog };
}

describe('toNotificationPermission', () => {
  it('maps the OS answer to the five states the app acts on', () => {
    expect(
      [
        status({ status: PermissionStatus.GRANTED, granted: true }),
        status({ status: PermissionStatus.UNDETERMINED }),
        status({ canAskAgain: true }),
        status({ canAskAgain: false }),
        status({ ios: iosStatus(IosAuthorizationStatus.PROVISIONAL) }),
        status({ ios: iosStatus(IosAuthorizationStatus.EPHEMERAL) }),
      ].map(toNotificationPermission),
    ).toStrictEqual(['granted', 'undetermined', 'denied', 'blocked', 'provisional', 'granted']);
  });
});

describe('createExpoLocalNotificationsAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('installs one foreground handler that shows the notification with sound', async () => {
    createAdapter();
    const handler = native.setNotificationHandler.mock.calls[0]?.[0];

    expect(native.setNotificationHandler).toHaveBeenCalledTimes(1);
    await expect(handler?.handleNotification()).resolves.toStrictEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    });
  });

  it('leaves the foreground handler to push-notifications when told to', () => {
    createAdapter(false);

    expect(native.setNotificationHandler).not.toHaveBeenCalled();
  });

  it('schedules one-shot date triggers on their channel with the reminder data', async () => {
    native.scheduleNotificationAsync.mockResolvedValue('id');
    const { adapter } = createAdapter();

    await expect(adapter.scheduleNotifications(plan)).resolves.toStrictEqual([]);
    expect(native.scheduleNotificationAsync.mock.calls[0]?.[0]).toStrictEqual({
      identifier: plan[0]?.id,
      content: {
        title: plan[0]?.title,
        body: plan[0]?.body,
        data: { kind: 'reminder', reminderId: 'task-42' },
      },
      trigger: { type: 'date', date: plan[0]?.fireAtMs, channelId: 'reminders' },
    });
  });

  it('reports a refused notification and still schedules the next one', async () => {
    native.scheduleNotificationAsync
      .mockRejectedValueOnce(new Error('trigger in the past'))
      .mockResolvedValueOnce('id');
    const { adapter } = createAdapter();

    const failures = await adapter.scheduleNotifications(plan);

    expect(failures).toStrictEqual([
      { id: plan[0]?.id, failure: { kind: 'os-refused', detail: 'trigger in the past' } },
    ]);
    expect(native.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });

  it('lists pending identifiers, and turns a failed read into a value', async () => {
    native.getAllScheduledNotificationsAsync
      .mockResolvedValueOnce([{ identifier: 'a' }, { identifier: 'b' }])
      .mockRejectedValueOnce(new Error('busy'));
    const { adapter } = createAdapter();

    await expect(adapter.pendingIds()).resolves.toStrictEqual({ ok: true, value: ['a', 'b'] });
    await expect(adapter.pendingIds()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'os-refused', detail: 'busy' },
    });
  });

  it('cancels by identifier and logs a refusal instead of rejecting', async () => {
    native.cancelScheduledNotificationAsync
      .mockRejectedValueOnce(new Error('gone'))
      .mockResolvedValueOnce(undefined);
    const { adapter, errorLog } = createAdapter();

    await adapter.cancelNotifications(['a', 'b']);

    expect(native.cancelScheduledNotificationAsync.mock.calls).toStrictEqual([['a'], ['b']]);
    expect(errorLog.entries()).toHaveLength(1);
  });

  it('creates channels with their importance, and logs a refusal', async () => {
    native.setNotificationChannelAsync
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('no'));
    const { adapter, errorLog } = createAdapter();

    await adapter.syncChannels([
      { id: 'reminders', name: 'Reminders', description: 'Task reminders', importance: 'high' },
      { id: 'digest', name: 'Digest', description: 'Daily digest', importance: 'low' },
    ]);

    expect(native.setNotificationChannelAsync.mock.calls[0]).toStrictEqual([
      'reminders',
      { name: 'Reminders', description: 'Task reminders', importance: AndroidImportance.HIGH },
    ]);
    expect(errorLog.entries()).toHaveLength(1);
  });

  it('reads the permission without prompting, and asks only for alerts and sound', async () => {
    native.getPermissionsAsync.mockResolvedValueOnce(
      status({ status: PermissionStatus.UNDETERMINED }),
    );
    native.requestPermissionsAsync.mockResolvedValueOnce(
      status({ status: PermissionStatus.GRANTED, granted: true }),
    );
    const { adapter } = createAdapter();

    await expect(adapter.permission()).resolves.toBe('undetermined');
    await expect(adapter.requestPermission()).resolves.toBe('granted');
    expect(native.requestPermissionsAsync).toHaveBeenCalledWith({
      ios: { allowAlert: true, allowSound: true },
    });
  });

  it('turns the launch tap and later taps into NotificationTap values', () => {
    native.getLastNotificationResponse.mockReturnValueOnce(
      response(native.DEFAULT_ACTION_IDENTIFIER),
    );
    const remove = jest.fn();
    native.addNotificationResponseReceivedListener.mockReturnValueOnce({ remove });
    const { adapter } = createAdapter();
    const taps: unknown[] = [];

    const last = adapter.lastTap();
    const unsubscribe = adapter.onTap((tap) => taps.push(tap));
    native.addNotificationResponseReceivedListener.mock.calls[0]?.[0](response('snooze'));
    unsubscribe();
    adapter.clearLastTap();

    expect(last).toStrictEqual({
      id: 'reminder:task-42:x:y',
      action: 'open',
      data: { kind: 'reminder' },
    });
    expect(taps).toStrictEqual([
      { id: 'reminder:task-42:x:y', action: 'snooze', data: { kind: 'reminder' } },
    ]);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(native.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
  });
});
