// src/services/create-device-services.ts
// The composition root: the one place that creates device adapters. The root layout calls it once
// (a useState initializer), never at module level: a reload re-runs every module.
import { createSystemClockAdapter } from '@/services/clock/system-clock-adapter';
import { createKvDirectionGuardAdapter } from '@/services/direction-guard/kv-direction-guard-adapter';
import { createMemoryErrorLogAdapter } from '@/services/error-log/memory-error-log-adapter';

import type { Services } from '@/services/services-context';

/** Creates every device adapter once and returns them as the app's Services. */
export function createDeviceServices(): Services {
  const clock = createSystemClockAdapter();
  return {
    clock,
    directionGuard: createKvDirectionGuardAdapter(),
    errorLog: createMemoryErrorLogAdapter({ clock }),
  };
}
