// src/services/create-device-services.ts
// Shape to imitate (not a template): the composition root with the two ports this skill needs. The
// purchase port is created here, once, gated by the one ConnectivityPort: the only place that may
// call createExpoIapPurchaseAdapter (architecture-and-boundaries: adapters live in the composition
// root). Services gains `connectivity: ConnectivityPort` and `purchase: PurchasePort`, and
// create-test-services.ts gives tests createFakeConnectivity(...) and createFakePurchase(...).
import { createSystemClockAdapter } from '@/services/clock/system-clock-adapter';
import { createExpoNetworkConnectivityAdapter } from '@/services/connectivity/expo-network-connectivity-adapter';
import { createKvDirectionGuardAdapter } from '@/services/direction-guard/kv-direction-guard-adapter';
import { createMemoryErrorLogAdapter } from '@/services/error-log/memory-error-log-adapter';
import { withConnectivity } from '@/services/purchase/connectivity-gated-purchase';
import { createExpoIapPurchaseAdapter } from '@/services/purchase/expo-iap-purchase-adapter';

import type { Services } from '@/services/services-context';

/** Creates every device adapter once and returns them as the app's Services. */
export function createDeviceServices(): Services {
  const clock = createSystemClockAdapter();
  const errorLog = createMemoryErrorLogAdapter({ clock });
  const connectivity = createExpoNetworkConnectivityAdapter({ errorLog });
  return {
    clock,
    directionGuard: createKvDirectionGuardAdapter(),
    errorLog,
    connectivity,
    // Offline (or with a test build's simulated-offline switch wrapping `connectivity`) the store
    // reports itself unavailable without asking StoreKit or Play Billing.
    purchase: withConnectivity(createExpoIapPurchaseAdapter(), connectivity.isOnline),
  };
}
