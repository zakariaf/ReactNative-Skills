// src/services/create-device-services.ts
import { createKvDirectionGuardAdapter } from '@/services/direction-guard/kv-direction-guard-adapter';
import { createExpoSecureStoreSessionAdapter } from '@/services/session/expo-secure-store-session-adapter';
import { createReactNativeShareAdapter } from '@/services/share/react-native-share-adapter';

import type { DirectionGuardPort } from '@/services/direction-guard/direction-guard-port';
import type { SessionPort } from '@/services/session/session-port';
import type { SharePort } from '@/services/share/share-port';

export type Services = { readonly share: SharePort; readonly session: SessionPort; readonly directionGuard: DirectionGuardPort };

/** Adapters only, no I/O: the root layout calls it in a state initializer, before the storage gate. */
export function createDeviceServices(): Services {
  return { share: createReactNativeShareAdapter(), session: createExpoSecureStoreSessionAdapter(), directionGuard: createKvDirectionGuardAdapter() };
}
