// src/data/expo-sqlite-warm-up-adapter.web.ts
// The storage warm-up in the web build (web-support). Three facts of expo-sqlite on the web (verified
// in Chrome with expo-sqlite 57.0.3):
// 1. SQLite runs in a Web Worker, and a synchronous call (openDatabaseSync, kv-store's getItemSync)
//    spins on a SharedArrayBuffer until the worker answers. A page has SharedArrayBuffer only when it
//    is cross-origin isolated; without it the first synchronous call throws "SharedArrayBuffer is not
//    defined" while an asynchronous open still succeeds. So isolation is checked first, and a page
//    without it reports 'unsupported' (a host without the headers, or Safari and every iOS browser
//    when the host sends COEP credentialless, which WebKit does not support: measured in WebKit 27.2,
//    where require-corp isolates the page and the app runs).
// 2. The first synchronous call gives up ("Sync operation timeout") while the worker is still loading
//    its WebAssembly and file systems. One asynchronous open waits for that start-up once; every
//    synchronous call made after it answers.
// 3. The database files live in the origin private file system through exclusive access handles, so
//    a second tab of the app cannot open them (openDatabaseSync throws there). An exclusive Web Lock,
//    held for the life of the page, tells the second tab before it touches storage. A page whose
//    browser gives it no origin private file system (WebKit in an ephemeral, private-browsing-like
//    session answered "UnknownError" and the first synchronous open threw) reports 'unsupported'.
import { openDatabaseAsync } from 'expo-sqlite';

import { attemptAsync } from '@/core/result';

import type * as NativeWarmUp from './expo-sqlite-warm-up-adapter';

/** The Web Lock the tab that owns the database holds until it closes. */
const STORAGE_LOCK_NAME = 'app-storage';

/**
 * One warm-up per page. The lock is held until the page unloads, so a second request from this same
 * tab would find it taken and report 'in-use-elsewhere': React Strict Mode, a Fast Refresh edit or
 * a remount of the root runs the gate's effect again, and each must get the first answer.
 */
let started: Promise<NativeWarmUp.StorageWarmUpResult> | undefined;

/** Takes the lock if no other tab holds it, and keeps it until the page unloads. */
function holdStorageLock(locks: LockManager): Promise<boolean> {
  return new Promise((resolve, reject) => {
    locks
      .request(STORAGE_LOCK_NAME, { ifAvailable: true }, (lock) => {
        resolve(lock !== null);
        // A promise that never settles keeps the lock for the life of the page.
        return lock === null ? undefined : new Promise<never>(() => undefined);
      })
      .catch(reject);
  });
}

/**
 * True when the browser gives this page an origin private file system (where the database files
 * live). A feature probe: the rejection is the answer (private browsing or blocked site data, where
 * the worker could not open the database files either), so it is converted, not caught.
 */
async function hasPrivateFileSystem(): Promise<boolean> {
  if (!('storage' in navigator)) return false;
  const probe = await attemptAsync(
    () => navigator.storage.getDirectory(),
    () => ({ kind: 'no-private-file-system' }) as const,
  );
  return probe.ok;
}

/** Isolation, the tab lock, the file system, then one in-memory open: the worker loads wa-sqlite and both file systems once. */
async function warmUpSqliteWorker(): Promise<NativeWarmUp.StorageWarmUpResult> {
  if (!globalThis.crossOriginIsolated) return 'unsupported';
  const isOwner = 'locks' in navigator ? await holdStorageLock(navigator.locks) : true;
  if (!isOwner) return 'in-use-elsewhere';
  if (!(await hasPrivateFileSystem())) return 'unsupported';
  const database = await openDatabaseAsync(':memory:');
  await database.closeAsync();
  return 'ready';
}

/** The web warm-up: every call in this page shares the first one's answer. */
export const createExpoSqliteWarmUpAdapter: typeof NativeWarmUp.createExpoSqliteWarmUpAdapter =
  () => () =>
    (started ??= warmUpSqliteWorker());
