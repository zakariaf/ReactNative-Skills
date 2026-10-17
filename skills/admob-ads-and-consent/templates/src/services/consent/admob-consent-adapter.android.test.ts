// src/services/consent/admob-consent-adapter.android.test.ts — the Android project (jest-expo's
// Android preset, Platform.OS 'android'): Google's consent works the same as on iOS. Whether Apple's
// prompt exists is the tracking adapter's business (expo-tracking-consent-adapter.android.test.ts).
import { createAdmobConsentAdapter } from './admob-consent-adapter';

jest.mock('react-native-google-mobile-ads');

type MockedSdk = { readonly AdsConsent: { readonly requestInfoUpdate: jest.Mock } };

const { AdsConsent } = jest.requireMock<MockedSdk>('react-native-google-mobile-ads');

describe('createAdmobConsentAdapter on Android', () => {
  it("asks Google's consent the same way as on iOS", async () => {
    const consent = createAdmobConsentAdapter({ tracking: null, onError: jest.fn() });

    await expect(consent.refresh()).resolves.toStrictEqual({
      canRequestAds: true,
      isPrivacyOptionsRequired: false,
    });
    expect(AdsConsent.requestInfoUpdate).toHaveBeenCalledWith({});
  });
});
