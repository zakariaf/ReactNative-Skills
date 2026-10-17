// src/services/consent/admob-consent-adapter.test.ts — drives the consent adapter against the root
// __mocks__/react-native-google-mobile-ads.ts. Lint bans importing the SDK outside the adapters, so
// the test reads the mock with jest.requireMock, typed with only what the assertions need. The
// explicit jest.mock() is required: without it, requireMock returns a second instance, not the one
// the adapter imported. Apple's prompt itself is expo-tracking-consent-adapter.test.ts.
import { createAdmobConsentAdapter } from './admob-consent-adapter';

import type { TrackingConsent } from './consent-port';

jest.mock('react-native-google-mobile-ads');

type MockedSdk = {
  readonly AdsConsent: {
    readonly requestInfoUpdate: jest.Mock<Promise<unknown>>;
    readonly getConsentInfo: jest.Mock<Promise<unknown>>;
  };
};

const { AdsConsent } = jest.requireMock<MockedSdk>('react-native-google-mobile-ads');

const REQUIRED = {
  status: 'REQUIRED',
  canRequestAds: false,
  privacyOptionsRequirementStatus: 'REQUIRED',
  isConsentFormAvailable: true,
};

/** A general-audience adapter whose ATT half answers `status`. */
function withTracking(status: 'authorized' | 'denied' = 'denied'): {
  readonly tracking: TrackingConsent & { readonly requestTracking: jest.Mock };
} {
  return { tracking: { requestTracking: jest.fn(() => Promise.resolve(status)) } };
}

describe('createAdmobConsentAdapter', () => {
  it('shows the privacy-options row when UMP requires it', async () => {
    AdsConsent.requestInfoUpdate.mockResolvedValueOnce(REQUIRED);
    const consent = createAdmobConsentAdapter({ ...withTracking(), onError: jest.fn() });

    await expect(consent.refresh()).resolves.toStrictEqual({
      canRequestAds: false,
      isPrivacyOptionsRequired: true,
    });
  });

  it("falls back to the last session's answer when the update fails offline", async () => {
    const onError = jest.fn();
    const offline = new Error('offline');
    AdsConsent.requestInfoUpdate.mockRejectedValueOnce(offline);
    const consent = createAdmobConsentAdapter({ ...withTracking(), onError });

    await expect(consent.refresh()).resolves.toStrictEqual({
      canRequestAds: true,
      isPrivacyOptionsRequired: false,
    });
    expect(onError).toHaveBeenCalledWith(offline);
    expect(AdsConsent.getConsentInfo).toHaveBeenCalledTimes(1);
  });

  it('passes the debug geography and test devices only when a test build sets them', async () => {
    const base = { tracking: null, onError: jest.fn() };
    await createAdmobConsentAdapter(base).refresh();
    await createAdmobConsentAdapter({ ...base, debugGeography: 'eea' }).refresh();
    const devices = ['2077ef9a63d2b398840261c8221a0c9b'];
    const other = { debugGeography: 'other', testDeviceIdentifiers: devices } as const;
    await createAdmobConsentAdapter({ ...base, ...other }).refresh();

    expect(AdsConsent.requestInfoUpdate.mock.calls).toStrictEqual([
      [{}],
      [{ debugGeography: 1 }],
      [{ debugGeography: 4, testDeviceIdentifiers: devices }],
    ]);
  });
});

describe('requestTracking', () => {
  it("asks through the tracking option (Apple's prompt) for a general audience", async () => {
    const options = withTracking('authorized');
    const consent = createAdmobConsentAdapter({ ...options, onError: jest.fn() });

    await expect(consent.requestTracking()).resolves.toBe('authorized');
    expect(options.tracking.requestTracking).toHaveBeenCalledTimes(1);
  });

  it('answers unavailable and asks nothing in a child-directed app (tracking: null)', async () => {
    const consent = createAdmobConsentAdapter({ tracking: null, onError: jest.fn() });

    await expect(consent.requestTracking()).resolves.toBe('unavailable');
  });
});
