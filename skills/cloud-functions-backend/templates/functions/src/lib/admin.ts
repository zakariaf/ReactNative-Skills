// functions/src/lib/admin.ts
// The Admin SDK is initialised on first use, never at import time, so deploy-time analysis and unit
// tests that never touch Firestore do not need credentials.
import { getApps, initializeApp } from 'firebase-admin/app';
import { type Firestore, getFirestore } from 'firebase-admin/firestore';

export function db(): Firestore {
  if (getApps().length === 0) initializeApp();
  return getFirestore();
}
