// examples/create-firebase-services.ts: the Firebase part of a Tasks app's composition root (a shape to
// imitate inside src/services/create-device-services.ts, never copied as is). Order matters: App Check
// first, then the Firestore instance with its settings and emulator, then the per-user adapters.
import { Platform } from 'react-native';

import { parseAppVariant } from '@/config/app-variant';
import { firebaseEmulators } from '@/config/firebase-emulators';
import { createFirestoreClient } from '@/data/firestore/firestore-client-adapter';
import { createFirestoreTaskAdapter } from '@/data/firestore/firestore-task-adapter';
import { appCheckProviderOptions } from '@/services/app-check/app-check-providers';
import { createRnfbAppCheckAdapter } from '@/services/app-check/rnfb-app-check-adapter';

import type { TaskStorePort, TaskWriteRejection } from '@/data/tasks/task-store-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

export type FirebaseServices = {
  /** Called by the auth adapter's listener once a user is signed in (and again on a user change). */
  readonly tasksFor: (uid: string) => TaskStorePort;
};

export function createFirebaseServices(errorLog: ErrorLogPort): FirebaseServices {
  // Metro inlines EXPO_PUBLIC_APP_VARIANT; the composition root may already hold the parsed variant.
  const variant = parseAppVariant(process.env.EXPO_PUBLIC_APP_VARIANT ?? 'development');

  // 1. App Check before any Firestore, Storage or Functions request.
  const started = createRnfbAppCheckAdapter(appCheckProviderOptions(variant, process.env.EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN)).start();
  if (!started.ok) errorLog.record('startup', started.error);

  // 2. One Firestore instance: settings first, then the emulator (development only).
  const emulators = firebaseEmulators({
    variant,
    platform: Platform.OS === 'android' ? 'android' : 'ios',
    hostOverride: process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST,
  });
  const db = createFirestoreClient(emulators);

  // 3. Adapters per signed-in user; a refused write goes to the error log (and to a store when the UI must say so).
  const onWriteRejected = (rejection: TaskWriteRejection): void => {
    errorLog.record('storage', rejection);
  };
  return { tasksFor: (uid) => createFirestoreTaskAdapter({ db, uid, onWriteRejected }) };
}
