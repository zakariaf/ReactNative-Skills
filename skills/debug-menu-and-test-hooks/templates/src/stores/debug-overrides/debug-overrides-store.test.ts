// src/stores/debug-overrides/debug-overrides-store.test.ts
// The thin store test: a subscriber already sees the value on disk, a failed write publishes nothing
// but the failure, a change that changes nothing writes nothing.
import { createFakeDebugStorage } from '@/services/debug-storage/fake-debug-storage';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { DEFAULT_DEBUG_OVERRIDES, encodeDebugOverrides } from './debug-overrides';
import { createDebugOverridesStore } from './debug-overrides-store';

describe('createDebugOverridesStore', () => {
  it('hydrates from the stored text', () => {
    const storage = createFakeDebugStorage(
      encodeDebugOverrides({ ...DEFAULT_DEBUG_OVERRIDES, motion: 'still' }),
    );

    const store = createDebugOverridesStore({ storage, errorLog: createFakeErrorLog() });

    expect(store.getState().overrides.motion).toBe('still');
  });

  it('writes before it publishes', () => {
    const storage = createFakeDebugStorage();
    const store = createDebugOverridesStore({ storage, errorLog: createFakeErrorLog() });
    const seenOnDisk: (string | null)[] = [];
    store.subscribe(() => {
      seenOnDisk.push(storage.stored());
    });

    store.getState().dispatch({ type: 'set-canvas-probe', isOn: true });

    expect(seenOnDisk).toHaveLength(1);
    expect(seenOnDisk[0]).toContain('"isCanvasProbeOn":true');
  });

  it('publishes nothing but the failure when the write fails', () => {
    const storage = createFakeDebugStorage();
    const store = createDebugOverridesStore({ storage, errorLog: createFakeErrorLog() });
    storage.failOn('write');

    store.getState().dispatch({ type: 'set-offline', isOn: true });

    expect(store.getState().overrides.isOffline).toBe(false);
    expect(store.getState().lastWriteFailure).toStrictEqual({ kind: 'debug-storage-not-saved' });
  });

  it('writes nothing for a change that changes nothing', () => {
    const storage = createFakeDebugStorage();
    const store = createDebugOverridesStore({ storage, errorLog: createFakeErrorLog() });
    const before = store.getState();

    store.getState().dispatch({ type: 'use-real-day' });

    expect(storage.stored()).toBeNull();
    expect(store.getState()).toBe(before);
  });
});
