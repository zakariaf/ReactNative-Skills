// src/services/consent/admob-consent-debug-adapter.test.ts — drives the debug tools
// against the root __mocks__ (read with jest.requireMock: lint bans importing the SDK here). Apple's
// tracking answer has no reset, and this adapter never touches it.
import { createAdmobConsentDebugAdapter } from './admob-consent-debug-adapter';

jest.mock('react-native-google-mobile-ads');

type MockedSdk = {
  readonly default: jest.Mock<{ readonly openAdInspector: jest.Mock<Promise<void>> }>;
  readonly AdsConsent: {
    readonly reset: jest.Mock<void>;
    readonly getUserChoices: jest.Mock<Promise<unknown>>;
  };
};

const sdk = jest.requireMock<MockedSdk>('react-native-google-mobile-ads');

describe('createAdmobConsentDebugAdapter', () => {
  it('resets consent on this device only when asked', () => {
    const tools = createAdmobConsentDebugAdapter();
    expect(sdk.AdsConsent.reset).not.toHaveBeenCalled();

    tools.resetConsent();

    expect(sdk.AdsConsent.reset).toHaveBeenCalledTimes(1);
  });

  it('reads the decoded consent choices', async () => {
    sdk.AdsConsent.getUserChoices.mockResolvedValueOnce({ storeInformationOnDevice: true });

    await expect(createAdmobConsentDebugAdapter().readUserChoices()).resolves.toStrictEqual({
      storeInformationOnDevice: true,
    });
  });

  it('opens the Ad Inspector', async () => {
    await createAdmobConsentDebugAdapter().openAdInspector();

    expect(sdk.default().openAdInspector).toHaveBeenCalledTimes(1);
  });
});
