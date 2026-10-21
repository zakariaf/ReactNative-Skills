// src/data/firestore/firestore-client-adapter.ts
// The one Firestore instance: the native offline cache on (it survives app restarts and holds the
// queue of pending writes), a bounded cache size, estimated server timestamps, and the emulator only
// when the development variant asks for it. The composition root calls it once, after App Check has
// started and before any other Firestore call: settings given later apply only from the next launch.
import { getApp } from '@react-native-firebase/app';
import { connectFirestoreEmulator, initializeFirestore } from '@react-native-firebase/firestore';

import type { FirebaseEmulators } from '@/config/firebase-emulators';
import type { Firestore } from '@react-native-firebase/firestore';

/** 100 MB, the Firebase default made explicit; the SDK evicts unused documents above it. */
export const FIRESTORE_CACHE_BYTES = 100 * 1024 * 1024;

export function createFirestoreClient(emulators: FirebaseEmulators | null): Firestore {
  const db = initializeFirestore(getApp(), {
    persistence: true,
    cacheSizeBytes: FIRESTORE_CACHE_BYTES,
    serverTimestampBehavior: 'estimate',
  });
  if (emulators !== null) {
    connectFirestoreEmulator(db, emulators.host, emulators.ports.firestore);
  }
  return db;
}
