// src/services/app-check/app-check-providers.test.ts
import { appCheckProviderOptions } from './app-check-providers';

describe('appCheckProviderOptions', () => {
  it('uses the debug provider, with an optional registered token, only in development', () => {
    expect(appCheckProviderOptions('development')).toStrictEqual({
      apple: { provider: 'debug' },
      android: { provider: 'debug' },
    });
    expect(appCheckProviderOptions('development', 'token-1').android).toStrictEqual({
      provider: 'debug',
      debugToken: 'token-1',
    });
  });

  it.each(['preview', 'production'] as const)(
    'attests with App Attest and Play Integrity in %s, never with a debug token',
    (variant) => {
      expect(appCheckProviderOptions(variant, 'token-1')).toStrictEqual({
        apple: { provider: 'appAttestWithDeviceCheckFallback' },
        android: { provider: 'playIntegrity' },
      });
    },
  );
});
