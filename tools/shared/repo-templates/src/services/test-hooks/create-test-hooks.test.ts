// src/services/test-hooks/create-test-hooks.test.ts
import { createFakeClock } from '@/services/clock/fake-clock';
import { createFakeConnectivity } from '@/services/connectivity/fake-connectivity';
import { createTestServices } from '@/services/create-test-services';
import { createFakeDebugStorage } from '@/services/debug-storage/fake-debug-storage';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import {
  DEFAULT_DEBUG_OVERRIDES,
  encodeDebugOverrides,
} from '@/stores/debug-overrides/debug-overrides';

import { createTestHooks } from './create-test-hooks';

import type { TestHooks, TestHooksDeps } from './create-test-hooks';
import type { FakeConnectivity } from '@/services/connectivity/fake-connectivity';
import type { DebugStoragePort } from '@/services/debug-storage/debug-storage-port';
import type { FakeErrorLog } from '@/services/error-log/fake-error-log';
import type { Services } from '@/services/services-context';

const STORED_OFFLINE_DAY = encodeDebugOverrides({
  ...DEFAULT_DEBUG_OVERRIDES,
  today: '2030-05-05',
  isOffline: true,
});

/** The app's Services once networking-and-server-state added the connectivity port to them. */
type NetworkedServices = Services & { readonly connectivity: FakeConnectivity };

function servicesWith(errorLog: FakeErrorLog): Services {
  return createTestServices({
    clock: createFakeClock({ nowMs: 7, today: '2030-01-01' }),
    errorLog,
  });
}

function depsWith(
  storage: DebugStoragePort = createFakeDebugStorage(),
  errorLog: FakeErrorLog = createFakeErrorLog(),
): TestHooksDeps<NetworkedServices> {
  return {
    services: { ...servicesWith(errorLog), connectivity: createFakeConnectivity(true) },
    storage,
    settings: null,
  };
}

describe('createTestHooks', () => {
  let hooks: TestHooks | null = null;

  afterEach(() => {
    hooks?.stop();
    hooks = null;
  });

  it('restores the stored switches before the first read (a reload keeps them)', () => {
    const run = createTestHooks(depsWith(createFakeDebugStorage(STORED_OFFLINE_DAY)));
    hooks = run;

    expect(run.services.clock.today()).toBe('2030-05-05');
    expect(run.services.clock.nowMs()).toBe(7);
    expect(run.services.connectivity.isOnline()).toBe(false);
  });

  it('swaps the clock and the connectivity inside the services and keeps every other port', () => {
    const deps = depsWith();
    const run = createTestHooks(deps);
    hooks = run;

    expect(run.services.errorLog).toBe(deps.services.errorLog);
    expect(run.services.clock).not.toBe(deps.services.clock);
    expect(run.services.connectivity).not.toBe(deps.services.connectivity);
  });

  it('makes every reader of services.connectivity hear the switch, while the device stays online', () => {
    const deps = depsWith();
    const run = createTestHooks(deps);
    hooks = run;
    const heard: boolean[] = [];
    run.services.connectivity.subscribe((isOnline) => heard.push(isOnline));

    run.overrides.getState().dispatch({ type: 'set-offline', isOn: true });
    run.overrides.getState().dispatch({ type: 'set-offline', isOn: false });

    expect(heard).toStrictEqual([false, true]);
    expect(deps.services.connectivity.isOnline()).toBe(true);
  });

  it('applies a change to the wrappers at once and stores it first', () => {
    const storage = createFakeDebugStorage();
    const run = createTestHooks(depsWith(storage));
    hooks = run;

    run.overrides.getState().dispatch({
      type: 'apply-overrides',
      patch: { today: '2030-07-01', isOffline: true },
    });

    expect(run.services.clock.today()).toBe('2030-07-01');
    expect(run.services.connectivity.reachability()).toBe('none');
    expect(storage.stored()).toContain('"today":"2030-07-01"');
  });

  it('logs a store it cannot read, starts from the defaults and never writes', () => {
    const errorLog = createFakeErrorLog();
    const run = createTestHooks(depsWith(createFakeDebugStorage('{'), errorLog));
    hooks = run;

    expect(run.services.clock.today()).toBe('2030-01-01');
    expect(errorLog.entries().map((entry) => entry.message)).toStrictEqual([
      'debug-overrides-unreadable',
    ]);
  });

  it('publishes nothing but the failure when a write fails', () => {
    const storage = createFakeDebugStorage();
    const errorLog = createFakeErrorLog();
    const run = createTestHooks(depsWith(storage, errorLog));
    hooks = run;
    storage.failOn('write');

    run.overrides.getState().dispatch({ type: 'set-offline', isOn: true });

    expect(run.services.connectivity.isOnline()).toBe(true);
    expect(run.overrides.getState().lastWriteFailure).toStrictEqual({
      kind: 'debug-storage-not-saved',
    });
    expect(errorLog.entries().map((entry) => entry.message)).toStrictEqual([
      'debug-storage-not-saved',
    ]);
  });

  it('keeps changes in memory when the store cannot be read at all', () => {
    const storage = createFakeDebugStorage();
    storage.failOn('read');
    const run = createTestHooks(depsWith(storage));
    hooks = run;

    run.overrides.getState().dispatch({ type: 'set-motion', motion: 'still' });

    expect(run.overrides.getState().overrides.motion).toBe('still');
    expect(storage.stored()).toBeNull();
  });

  it('works for services without a connectivity port and keeps the settings target', () => {
    const apply = jest.fn(() => Promise.resolve('applied' as const));
    const run = createTestHooks({
      services: servicesWith(createFakeErrorLog()),
      storage: createFakeDebugStorage(),
      settings: { apply },
    });
    hooks = run;

    expect(Object.keys(run.services)).not.toContain('connectivity');
    expect(run.settings?.apply).toBe(apply);
  });

  it('stops following the real port', () => {
    const deps = depsWith();
    createTestHooks(deps).stop();

    expect(deps.services.connectivity.listenerCount()).toBe(0);
  });
});
