// src/services/create-device-services.ts
// The composition root: the one place that creates device adapters. The root layout calls it once
// (a useState initializer), never at module level: a reload re-runs every module.
import { createFetchApiClient, deviceFetch } from '@/api/fetch-api-client';
import { readOauthConfig } from '@/config/oauth-config';
import { createExpoAppleSignInAdapter } from '@/services/apple-sign-in/expo-apple-sign-in-adapter';
import { createSystemClockAdapter } from '@/services/clock/system-clock-adapter';
import { createKvDirectionGuardAdapter } from '@/services/direction-guard/kv-direction-guard-adapter';
import { createMemoryErrorLogAdapter } from '@/services/error-log/memory-error-log-adapter';
import { createKvInstallMarkerAdapter } from '@/services/install-marker/kv-install-marker-adapter';
import { createAuthSessionOauthAdapter } from '@/services/oauth/auth-session-oauth-adapter';
import { createExpoSecureStoreAdapter } from '@/services/secure-storage/expo-secure-store-adapter';

import type { PublicEnvironment } from '@/config/environment';
import type { Services } from '@/services/services-context';

/** Creates every device adapter once and returns them as the app's Services. */
export function createDeviceServices(environment: PublicEnvironment): Services {
  const clock = createSystemClockAdapter();
  const errorLog = createMemoryErrorLogAdapter({ clock });
  return {
    api: createFetchApiClient({ baseUrl: environment.apiBaseUrl, fetch: deviceFetch, errorLog }),
    clock,
    directionGuard: createKvDirectionGuardAdapter(),
    errorLog,
    secureStorage: createExpoSecureStoreAdapter({ errorLog }),
    installMarker: createKvInstallMarkerAdapter({ errorLog }),
    oauth: createAuthSessionOauthAdapter(readOauthConfig()),
    appleSignIn: createExpoAppleSignInAdapter(),
  };
}
