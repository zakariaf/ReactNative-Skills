// src/services/app-check/app-check-providers.ts
// Which App Check provider each build uses. Pure, so every branch is a Jest case. A development
// build uses the debug provider (simulators and emulators cannot attest; register the debug token it
// logs in the Firebase console); preview and production attest with the platform's own service.
import type { AppVariant } from '@/config/app-variant';

export type AppleProvider = 'debug' | 'appAttest' | 'appAttestWithDeviceCheckFallback';
export type AndroidProvider = 'debug' | 'playIntegrity';

export type AppCheckProviderOptions = {
  readonly apple: { readonly provider: AppleProvider; readonly debugToken?: string };
  readonly android: { readonly provider: AndroidProvider; readonly debugToken?: string };
};

/**
 * The provider options for this build. `debugToken` (a CI emulator run's registered token) is used
 * only by the development variant; preview and production never carry one.
 */
export function appCheckProviderOptions(
  variant: AppVariant,
  debugToken?: string,
): AppCheckProviderOptions {
  if (variant === 'development') {
    const token = debugToken === undefined || debugToken === '' ? {} : { debugToken };
    return { apple: { provider: 'debug', ...token }, android: { provider: 'debug', ...token } };
  }
  return {
    apple: { provider: 'appAttestWithDeviceCheckFallback' },
    android: { provider: 'playIntegrity' },
  };
}
