// src/services/create-device-services.ts (example: the composition root with the server-state ports)
// The one place that creates device adapters, called once from the root layout's useState initializer
// with the environment the config reader checked (a test passes a literal one). The connectivity
// adapter subscribes to expo-network once for the app's whole life; the ApiClient gets the base URL,
// the device fetch and the error log.
import { createFetchApiClient, deviceFetch } from '@/api/fetch-api-client';
import { createSystemClockAdapter } from '@/services/clock/system-clock-adapter';
import { createExpoNetworkConnectivityAdapter } from '@/services/connectivity/expo-network-connectivity-adapter';
import { createKvDirectionGuardAdapter } from '@/services/direction-guard/kv-direction-guard-adapter';
import { createMemoryErrorLogAdapter } from '@/services/error-log/memory-error-log-adapter';

import type { PublicEnvironment } from '@/config/environment';
import type { Services } from '@/services/services-context';

/** Creates every device adapter once and returns them as the app's Services. */
export function createDeviceServices(environment: PublicEnvironment): Services {
  const clock = createSystemClockAdapter();
  const errorLog = createMemoryErrorLogAdapter({ clock });
  return {
    clock,
    directionGuard: createKvDirectionGuardAdapter(),
    errorLog,
    connectivity: createExpoNetworkConnectivityAdapter({ errorLog }),
    api: createFetchApiClient({ baseUrl: environment.apiBaseUrl, fetch: deviceFetch, errorLog }),
  };
}
