// src/services/sync-status/watch-sync-status.test.ts (example: a shape to imitate, never copied)
import { flushMicrotasks } from '@test/flush-microtasks';

import { watchSyncStatus } from './watch-sync-status';

import type { SyncStatus, SyncStatusSource } from './watch-sync-status';

/** A source whose read waits for the test and whose events the test emits. */
function createControlledSource(): {
  readonly source: SyncStatusSource;
  readonly emit: (status: SyncStatus) => void;
  readonly answerRead: (status: SyncStatus) => void;
  readonly failRead: (error: unknown) => void;
  readonly listenerCount: () => number;
} {
  const read = Promise.withResolvers<SyncStatus>();
  const listeners = new Set<(status: SyncStatus) => void>();
  return {
    source: {
      current: () => read.promise,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    emit: (status) => {
      for (const listener of listeners) listener(status);
    },
    answerRead: read.resolve,
    failRead: read.reject,
    listenerCount: () => listeners.size,
  };
}

describe('watchSyncStatus', () => {
  it('reports the first read when no change came first', async () => {
    const { source, answerRead } = createControlledSource();
    const seen: SyncStatus[] = [];
    watchSyncStatus(source, (status) => seen.push(status), jest.fn());
    answerRead('idle');
    await flushMicrotasks();

    expect(seen).toStrictEqual(['idle']);
  });

  it('drops a first read that a newer change event beat', async () => {
    const { source, emit, answerRead } = createControlledSource();
    const seen: SyncStatus[] = [];
    watchSyncStatus(source, (status) => seen.push(status), jest.fn());
    emit('syncing');
    answerRead('idle');
    await flushMicrotasks();

    expect(seen).toStrictEqual(['syncing']);
  });

  it('removes its listener and drops the pending read when stopped', async () => {
    const { source, emit, answerRead, listenerCount } = createControlledSource();
    const seen: SyncStatus[] = [];
    const stop = watchSyncStatus(source, (status) => seen.push(status), jest.fn());
    stop();
    emit('offline');
    answerRead('idle');
    await flushMicrotasks();

    expect(listenerCount()).toBe(0);
    expect(seen).toStrictEqual([]);
  });

  it('reports a failed first read unless it was cancelled', async () => {
    const { source, failRead } = createControlledSource();
    const onError = jest.fn<undefined, [unknown]>();
    const failure = new Error('status unavailable');
    watchSyncStatus(source, jest.fn(), onError);
    failRead(failure);
    await flushMicrotasks();

    expect(onError).toHaveBeenCalledWith(failure);
  });
});
