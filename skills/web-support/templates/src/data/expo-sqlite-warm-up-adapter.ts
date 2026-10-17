// src/data/expo-sqlite-warm-up-adapter.ts
// The storage warm-up on iOS and Android: nothing to wait for (web-support). expo-sqlite answers
// synchronous calls at once on a device, so the root layout renders on its first frame as before.
// The web build takes expo-sqlite-warm-up-adapter.web.ts instead (Metro picks it by platform).

/**
 * What the warm-up found: storage answers; another browser tab of the app holds it; or this browser
 * cannot run it (the page is not cross-origin isolated, so there is no SharedArrayBuffer).
 */
export type StorageWarmUpResult = 'ready' | 'in-use-elsewhere' | 'unsupported';

/** Resolves when synchronous storage calls work. */
export type StorageWarmUp = () => Promise<StorageWarmUpResult>;

/** The warm-up the root layout waits for; null when synchronous calls work from the start. */
export function createExpoSqliteWarmUpAdapter(): StorageWarmUp | null {
  return null;
}
