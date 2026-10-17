// src/services/consent/expo-tracking-consent-adapter.android.test.ts — the Android project
// (jest-expo's Android preset, Platform.OS 'android'): App Tracking Transparency exists on iOS only,
// so the adapter answers 'unavailable' without touching the tracking module.
import { createExpoTrackingConsentAdapter } from './expo-tracking-consent-adapter';

jest.mock('expo-tracking-transparency');

type MockedTracking = {
  readonly getTrackingPermissionsAsync: jest.Mock;
  readonly requestTrackingPermissionsAsync: jest.Mock;
};

const tracking = jest.requireMock<MockedTracking>('expo-tracking-transparency');

describe('createExpoTrackingConsentAdapter on Android', () => {
  it('answers unavailable without touching the tracking module', async () => {
    const adapter = createExpoTrackingConsentAdapter({ onError: jest.fn() });

    await expect(adapter.requestTracking()).resolves.toBe('unavailable');
    expect(tracking.getTrackingPermissionsAsync).not.toHaveBeenCalled();
    expect(tracking.requestTrackingPermissionsAsync).not.toHaveBeenCalled();
  });
});
