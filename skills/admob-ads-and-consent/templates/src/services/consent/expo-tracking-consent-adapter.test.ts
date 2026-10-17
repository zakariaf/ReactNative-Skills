// src/services/consent/expo-tracking-consent-adapter.test.ts — drives Apple's ATT request against
// the root __mocks__/expo-tracking-transparency.ts. The explicit jest.mock() is required: without it,
// requireMock returns a second instance, not the one the adapter imported. Android behaviour (no ATT
// prompt) is in expo-tracking-consent-adapter.android.test.ts.
import { AppState } from 'react-native';

import { createExpoTrackingConsentAdapter } from './expo-tracking-consent-adapter';

import type { AppStateStatus } from 'react-native';

jest.mock('expo-tracking-transparency');

type Answer = { readonly status: 'granted' | 'denied' | 'undetermined' };
type MockedTracking = {
  readonly getTrackingPermissionsAsync: jest.Mock<Promise<Answer>>;
  readonly requestTrackingPermissionsAsync: jest.Mock<Promise<Answer>>;
};

const tracking = jest.requireMock<MockedTracking>('expo-tracking-transparency');

// React Native's Jest setup mocks AppState.currentState as a function; each test that needs a
// state sets the string the device would report and puts the mock back afterwards.
const CURRENT_STATE = Object.getOwnPropertyDescriptor(AppState, 'currentState');

/** The adapter's AppState 'change' listener, and a state the test moves by hand. */
function scriptAppState(start: AppStateStatus): (next: AppStateStatus) => void {
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: start });
  let listener: ((next: AppStateStatus) => void) | null = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    listener = handler;
    return { remove: jest.fn() };
  });
  return (next) => {
    listener?.(next);
  };
}

describe('createExpoTrackingConsentAdapter (App Tracking Transparency)', () => {
  afterEach(() => {
    if (CURRENT_STATE !== undefined) Object.defineProperty(AppState, 'currentState', CURRENT_STATE);
  });

  it('asks the system once while not-determined and returns the answer', async () => {
    scriptAppState('active');
    const adapter = createExpoTrackingConsentAdapter({ onError: jest.fn() });

    await expect(adapter.requestTracking()).resolves.toBe('denied');
    expect(tracking.requestTrackingPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['granted', 'authorized'],
    ['denied', 'denied'], // Expo reports a restricted device as denied too
  ] as const)('asks nothing again once the answer is %s', async (status, expected) => {
    tracking.getTrackingPermissionsAsync.mockResolvedValueOnce({ status });
    const adapter = createExpoTrackingConsentAdapter({ onError: jest.fn() });

    await expect(adapter.requestTracking()).resolves.toBe(expected);
    expect(tracking.requestTrackingPermissionsAsync).not.toHaveBeenCalled();
  });

  it('waits until the app is active: Apple shows no prompt in the background', async () => {
    const emit = scriptAppState('background');
    const pending = createExpoTrackingConsentAdapter({ onError: jest.fn() }).requestTracking();
    await Promise.resolve();
    await Promise.resolve();
    expect(tracking.requestTrackingPermissionsAsync).not.toHaveBeenCalled();

    emit('active');

    await expect(pending).resolves.toBe('denied');
    expect(tracking.requestTrackingPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('resolves unavailable when the read fails: logged, and ads go on without the IDFA', async () => {
    const onError = jest.fn();
    const broken = new Error('no native module');
    tracking.getTrackingPermissionsAsync.mockRejectedValueOnce(broken);

    await expect(createExpoTrackingConsentAdapter({ onError }).requestTracking()).resolves.toBe(
      'unavailable',
    );
    expect(onError).toHaveBeenCalledWith(broken);
  });
});
