// src/services/push/expo-notifications-push-adapter.test.ts
// Drives the adapter against Jest's automock of expo-notifications (iOS: the 'unit' project).
import { foregroundPresentation } from '@/core/push/foreground-presentation';
import { parsePushData } from '@/core/push/push-message';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { flushMicrotasks } from '@test/flush-microtasks';

import { createExpoNotificationsPushAdapter } from './expo-notifications-push-adapter';

import type {
  ExpoNotificationsPushOptions,
  ExpoNotificationsSdk,
} from './expo-notifications-push-adapter';
import type { PushToken } from './push-port';

jest.mock('expo-notifications');

const sdk = jest.mocked(jest.requireMock<ExpoNotificationsSdk>('expo-notifications'));

type Status = Awaited<ReturnType<ExpoNotificationsSdk['getPermissionsAsync']>>;
type Handler = NonNullable<Parameters<ExpoNotificationsSdk['setNotificationHandler']>[0]>;

/** A permission status as the SDK reports it (its enums are plain strings and numbers at run time). */
function status(fields: Readonly<Record<string, unknown>>): Status {
  return {
    status: 'undetermined',
    granted: false,
    canAskAgain: true,
    expires: 'never',
    ...fields,
  } as unknown as Status;
}

const BASE = status({});
const GRANTED = status({ status: 'granted', granted: true });
const PROJECT_ID = '0f3c3f0e-6a5e-4c55-9a59-2c1f5b2f7e10';

/** Listeners return a subscription in the real SDK; the automock returns undefined. */
function mockSubscriptions(): void {
  sdk.addPushTokenListener.mockReturnValue({ remove: jest.fn() });
  sdk.addNotificationResponseReceivedListener.mockReturnValue({ remove: jest.fn() });
}

function create(overrides: Partial<ExpoNotificationsPushOptions> = {}) {
  const errorLog = createFakeErrorLog();
  const push = createExpoNotificationsPushAdapter({
    projectId: PROJECT_ID,
    provider: 'expo',
    present: ({ isRemote, data }) =>
      foregroundPresentation({ isRemote, message: parsePushData(data) }),
    errorLog,
    ...overrides,
  });
  return { push, errorLog };
}

function notification(type: string, data: Record<string, unknown>) {
  return {
    date: 0,
    request: {
      identifier: 'n1',
      content: { title: null, subtitle: null, body: null, data },
      trigger: { type },
    },
  } as unknown as Parameters<Handler['handleNotification']>[0];
}

function handler(): Handler {
  const installed = sdk.setNotificationHandler.mock.calls.at(-1)?.[0];
  if (installed === undefined || installed === null) throw new Error('no handler installed');
  return installed;
}

describe('createExpoNotificationsPushAdapter: permission', () => {
  it.each([
    [{ status: 'undetermined', granted: false, canAskAgain: true }, 'undetermined'],
    [{ status: 'granted', granted: true }, 'granted'],
    [{ status: 'denied', granted: false, canAskAgain: true }, 'denied'],
    [{ status: 'denied', granted: false, canAskAgain: false }, 'blocked'],
    [{ status: 'granted', granted: true, ios: { status: 3 } }, 'provisional'],
  ])('maps %j to %s', async (fields, expected) => {
    sdk.getPermissionsAsync.mockResolvedValueOnce(status(fields));
    expect(await create().push.permission()).toBe(expected);
  });

  it('reads an SDK failure as undetermined (read) or denied (prompt), and records it', async () => {
    sdk.getPermissionsAsync.mockRejectedValueOnce(new Error('no activity'));
    sdk.requestPermissionsAsync.mockRejectedValueOnce(new Error('no activity'));
    const { push, errorLog } = create();
    expect(await push.permission()).toBe('undetermined');
    expect(await push.requestPermission()).toBe('denied');
    expect(errorLog.entries()).toHaveLength(2);
  });

  it('asks through requestPermissionsAsync', async () => {
    sdk.requestPermissionsAsync.mockResolvedValueOnce(GRANTED);
    expect(await create().push.requestPermission()).toBe('granted');
  });
});

describe('createExpoNotificationsPushAdapter: token', () => {
  beforeEach(mockSubscriptions);

  it('fetches an Expo token for the project from the device token', async () => {
    sdk.getPermissionsAsync.mockResolvedValue(GRANTED);
    sdk.getDevicePushTokenAsync.mockResolvedValueOnce({ type: 'ios', data: 'apns-1' });
    sdk.getExpoPushTokenAsync.mockResolvedValueOnce({ type: 'expo', data: 'ExponentPushToken[1]' });
    expect(await create().push.token()).toStrictEqual({
      ok: true,
      value: { provider: 'expo', value: 'ExponentPushToken[1]', platform: 'ios' },
    });
    expect(sdk.getExpoPushTokenAsync).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      devicePushToken: { type: 'ios', data: 'apns-1' },
    });
  });

  it('asks exp.host once per device token: two syncs in a row make one Expo token request', async () => {
    sdk.getExpoPushTokenAsync.mockClear();
    sdk.getPermissionsAsync.mockResolvedValue(GRANTED);
    sdk.getDevicePushTokenAsync
      .mockResolvedValueOnce({ type: 'ios', data: 'apns-1' })
      .mockResolvedValueOnce({ type: 'ios', data: 'apns-1' })
      .mockResolvedValueOnce({ type: 'ios', data: 'apns-2' });
    sdk.getExpoPushTokenAsync
      .mockResolvedValueOnce({ type: 'expo', data: 'ExponentPushToken[1]' })
      .mockResolvedValueOnce({ type: 'expo', data: 'ExponentPushToken[2]' });
    const { push } = create();
    const first = await push.token();
    const second = await push.token();
    const rotated = await push.token();
    expect(second).toStrictEqual(first);
    expect(rotated.ok && rotated.value.value).toBe('ExponentPushToken[2]');
    expect(sdk.getExpoPushTokenAsync).toHaveBeenCalledTimes(2);
  });

  it('returns the APNs token itself for a server that sends without Expo', async () => {
    sdk.getPermissionsAsync.mockResolvedValue(GRANTED);
    sdk.getDevicePushTokenAsync.mockResolvedValueOnce({ type: 'ios', data: 'apns-1' });
    const token = await create({ provider: 'native', projectId: null }).push.token();
    expect(token).toStrictEqual({
      ok: true,
      value: { provider: 'apns', value: 'apns-1', platform: 'ios' },
    });
  });

  it('fetches nothing without the permission or the project id', async () => {
    sdk.getPermissionsAsync.mockResolvedValue(BASE);
    expect(await create().push.token()).toStrictEqual({
      ok: false,
      error: { kind: 'not-allowed' },
    });
    sdk.getPermissionsAsync.mockResolvedValue(GRANTED);
    expect(await create({ projectId: null }).push.token()).toStrictEqual({
      ok: false,
      error: { kind: 'missing-project-id' },
    });
    expect(sdk.getDevicePushTokenAsync).not.toHaveBeenCalled();
  });

  it.each([
    ['ERR_NOTIFICATIONS_NETWORK_ERROR', { kind: 'network-unavailable' }],
    ['ERR_NOTIFICATIONS_SERVER_ERROR', { kind: 'network-unavailable' }],
    ['E_REGISTRATION_FAILED', { kind: 'token-unavailable', code: 'E_REGISTRATION_FAILED' }],
  ])('maps the native error %s', async (code, failure) => {
    sdk.getPermissionsAsync.mockResolvedValue(GRANTED);
    sdk.getDevicePushTokenAsync.mockRejectedValueOnce(Object.assign(new Error(code), { code }));
    expect(await create().push.token()).toStrictEqual({ ok: false, error: failure });
  });

  it('maps a failed permission read to its failure instead of rejecting', async () => {
    sdk.getPermissionsAsync.mockRejectedValueOnce(new Error('gone'));
    expect(await create().push.token()).toStrictEqual({
      ok: false,
      error: { kind: 'token-unavailable', code: null },
    });
  });

  it('turns a rotated device token into an Expo token, and records a failed one', async () => {
    const { push, errorLog } = create();
    const seen: PushToken[] = [];
    const stop = push.onTokenChange((token) => seen.push(token));
    const rotate = sdk.addPushTokenListener.mock.calls.at(-1)?.[0];
    sdk.getExpoPushTokenAsync.mockResolvedValueOnce({ type: 'expo', data: 'ExponentPushToken[2]' });
    rotate?.({ type: 'ios', data: 'apns-2' });
    sdk.getExpoPushTokenAsync.mockRejectedValueOnce(new Error('offline'));
    rotate?.({ type: 'ios', data: 'apns-3' });
    await flushMicrotasks();
    stop();
    expect(seen).toStrictEqual([
      { provider: 'expo', value: 'ExponentPushToken[2]', platform: 'ios' },
    ]);
    expect(errorLog.entries()[0]?.message).toBe('push token rotation failed');
  });
});

describe('createExpoNotificationsPushAdapter: foreground and taps', () => {
  beforeEach(mockSubscriptions);

  it('installs one handler that is loud for assigned work and quiet for a broadcast', async () => {
    create();
    const handle = handler().handleNotification;
    expect(
      await handle(notification('push', { kind: 'task-assigned', taskId: 't1' })),
    ).toStrictEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    });
    expect((await handle(notification('push', { kind: 'announcement' }))).shouldShowBanner).toBe(
      false,
    );
    expect((await handle(notification('date', {}))).shouldShowBanner).toBe(true);
    expect(sdk.setNotificationHandler).toHaveBeenCalledTimes(1);
  });

  it('records a handler error', () => {
    const { errorLog } = create();
    handler().handleError?.('n1', new Error('timeout'));
    expect(errorLog.entries()[0]?.message).toBe('foreground notification failed');
  });

  it('maps the launch tap and later taps, and clears the launch tap', () => {
    const tap = {
      notification: notification('push', { kind: 'announcement' }),
      actionIdentifier: sdk.DEFAULT_ACTION_IDENTIFIER,
    };
    sdk.getLastNotificationResponse.mockReturnValueOnce(tap).mockReturnValueOnce(null);
    const { push } = create();
    expect(push.lastResponse()).toStrictEqual({
      id: 'n1',
      action: 'open',
      data: { kind: 'announcement' },
    });
    expect(push.lastResponse()).toBeNull();
    push.clearLastResponse();
    expect(sdk.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
    const seen: string[] = [];
    const stop = push.onResponse((response) => seen.push(response.action));
    sdk.addNotificationResponseReceivedListener.mock.calls.at(-1)?.[0]({
      ...tap,
      actionIdentifier: 'snooze',
    });
    stop();
    expect(seen).toStrictEqual(['snooze']);
  });

  it('creates no channel on iOS', async () => {
    await create().push.syncChannels([
      { id: 'general', name: 'G', description: '', importance: 'default' },
    ]);
    expect(sdk.setNotificationChannelAsync).not.toHaveBeenCalled();
  });
});
