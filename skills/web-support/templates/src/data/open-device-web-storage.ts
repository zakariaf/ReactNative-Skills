// src/data/open-device-web-storage.ts
// What the root layout waits for before anything opens device storage (web-support): part of the
// composition root, so the root layout reaches the warm-up adapter through it, once:
//   const [storageWarmUp] = useState(openDeviceWebStorage);
//   <WebStorageGate warmUp={storageWarmUp} ...> (the root layout's outermost element)
// null on iOS and Android (the first frame renders at once); the expo-sqlite worker start-up and the
// one-tab lock in the web build.
import { createExpoSqliteWarmUpAdapter } from './expo-sqlite-warm-up-adapter';

import type { StorageWarmUp } from './expo-sqlite-warm-up-adapter';

export type { StorageWarmUp, StorageWarmUpResult } from './expo-sqlite-warm-up-adapter';

/** The warm-up the root layout hands to WebStorageGate, or null when there is nothing to wait for. */
export function openDeviceWebStorage(): StorageWarmUp | null {
  return createExpoSqliteWarmUpAdapter();
}
