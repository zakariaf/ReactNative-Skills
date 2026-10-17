// src/services/background-tasks/expo-background-tasks-adapter.android.test.ts
// The Android project of the Jest config (Platform.OS 'android'): the expiry event is iOS-only.
import { watchBackgroundExpiry } from './expo-background-tasks-adapter';

jest.mock('expo-background-task', () => ({ addExpirationListener: jest.fn() }));

type MockedBackgroundTask = { readonly addExpirationListener: jest.Mock };

const backgroundTask = jest.requireMock<MockedBackgroundTask>('expo-background-task');

describe('watchBackgroundExpiry on Android', () => {
  it('subscribes to nothing and hands back a harmless subscription', () => {
    const subscription = watchBackgroundExpiry(jest.fn());

    expect(() => {
      subscription.remove();
    }).not.toThrow();
    expect(backgroundTask.addExpirationListener).not.toHaveBeenCalled();
  });
});
