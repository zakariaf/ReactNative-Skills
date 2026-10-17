// src/services/push/expo-notifications-push-adapter.android.test.ts
// The Android half (the 'android' Jest project: Platform.OS is 'android'). jest-expo's Android
// environment looks like Expo Go, where importing expo-notifications fails on purpose (remote push
// left Expo Go on Android in SDK 53), so this file mocks the module with a factory instead of
// Jest's automock, which would load the real module first.
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { createExpoNotificationsPushAdapter } from './expo-notifications-push-adapter';

import type { ExpoNotificationsSdk } from './expo-notifications-push-adapter';

jest.mock('expo-notifications', () => ({
  AndroidImportance: { LOW: 4, DEFAULT: 5, HIGH: 6 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(),
}));

const sdk = jest.mocked(jest.requireMock<ExpoNotificationsSdk>('expo-notifications'));

function create(provider: 'expo' | 'native') {
  return createExpoNotificationsPushAdapter({
    projectId: null,
    provider,
    present: () => ({ banner: true, list: true, sound: true, badge: false }),
    errorLog: createFakeErrorLog(),
  });
}

describe('createExpoNotificationsPushAdapter on Android', () => {
  it('creates every channel with its translated texts and importance', async () => {
    await create('expo').syncChannels([
      { id: 'general', name: 'General', description: 'News', importance: 'default' },
      { id: 'task-updates', name: 'Task updates', description: 'Shared lists', importance: 'high' },
    ]);
    expect(sdk.setNotificationChannelAsync.mock.calls).toStrictEqual([
      ['general', { name: 'General', description: 'News', importance: 5 }],
      ['task-updates', { name: 'Task updates', description: 'Shared lists', importance: 6 }],
    ]);
  });

  it('records a channel failure instead of rejecting', async () => {
    const errorLog = createFakeErrorLog();
    sdk.setNotificationChannelAsync.mockRejectedValueOnce(new Error('bad importance'));
    const push = createExpoNotificationsPushAdapter({
      projectId: null,
      provider: 'expo',
      present: () => ({ banner: true, list: true, sound: true, badge: false }),
      errorLog,
    });
    await push.syncChannels([
      { id: 'general', name: 'General', description: '', importance: 'low' },
    ]);
    expect(errorLog.entries()[0]?.message).toBe('notification channels failed');
  });

  it('returns the FCM token for a server that sends without Expo', async () => {
    const granted = { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
    sdk.getPermissionsAsync.mockResolvedValue(
      granted as unknown as Awaited<ReturnType<ExpoNotificationsSdk['getPermissionsAsync']>>,
    );
    sdk.getDevicePushTokenAsync.mockResolvedValueOnce({ type: 'android', data: 'fcm-1' });
    expect(await create('native').token()).toStrictEqual({
      ok: true,
      value: { provider: 'fcm', value: 'fcm-1', platform: 'android' },
    });
  });
});
