// src/services/sync-status/watch-sync-status.ts (example: a shape to imitate, never copied)
// Mirroring an outside value that has both a change event and an async "read it now" call (network
// state, a permission, an accessibility switch, a purchase status): subscribe first, so no change is
// missed, then read; a change event that arrives while the read is in flight is newer than the
// read, so it cancels it and the late read result is dropped. Read first, subscribe second, and a
// change between the two is lost; read without the cancel, and an old value can overwrite a new
// one. The returned stop removes the listener and drops any read still running.
import { createLatestRequest } from '@/core/async/latest-request';

export type SyncStatus = 'idle' | 'syncing' | 'offline';

/** What the watcher needs of the source: a read and a change subscription that returns its removal. */
export type SyncStatusSource = {
  readonly current: () => Promise<SyncStatus>;
  readonly subscribe: (listener: (status: SyncStatus) => void) => () => void;
};

/** Calls `onStatus` with every change and with the first read unless a change beat it; returns the stop. */
export function watchSyncStatus(
  source: SyncStatusSource,
  onStatus: (status: SyncStatus) => void,
  onError: (error: unknown) => void,
): () => void {
  const firstRead = createLatestRequest();
  const signal = firstRead.start();
  const unsubscribe = source.subscribe((status) => {
    firstRead.cancel();
    onStatus(status);
  });
  source
    .current()
    .then((status) => {
      if (!signal.aborted) onStatus(status);
    })
    .catch((error: unknown) => {
      if (!signal.aborted) onError(error);
    });
  return () => {
    firstRead.cancel();
    unsubscribe();
  };
}
