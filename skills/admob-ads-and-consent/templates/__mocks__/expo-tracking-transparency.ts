// __mocks__/expo-tracking-transparency.ts — root manual mock (automatic in every Jest project).
// jest-expo 57 mocks only the native module ExpoTrackingTransparency, whose functions answer
// undefined, so the package's own JS would crash on response.status. Only the consent
// adapter (src/services/consent/) imports the package; its test scripts the answers through
// jest.mock('expo-tracking-transparency') + jest.requireMock('expo-tracking-transparency').
// The defaults: nothing asked yet ('undetermined'), and the user declines when asked.
type Status = 'granted' | 'denied' | 'undetermined';
type Response = {
  readonly status: Status;
  readonly granted: boolean;
  readonly canAskAgain: boolean;
  readonly expires: 'never';
};

// The package's enum values (expo's PermissionStatus).
export const PermissionStatus = {
  GRANTED: 'granted',
  UNDETERMINED: 'undetermined',
  DENIED: 'denied',
} as const;

function response(status: Status): Response {
  return {
    status,
    granted: status === 'granted',
    canAskAgain: status === 'undetermined',
    expires: 'never',
  };
}

export const getTrackingPermissionsAsync = jest.fn(() => Promise.resolve(response('undetermined')));
export const requestTrackingPermissionsAsync = jest.fn(() => Promise.resolve(response('denied')));
export const getAdvertisingId = jest.fn((): string | null => null);
export const isAvailable = jest.fn(() => true);
