// src/services/permissions/permission-status-mirror.test.ts
import { AppState } from 'react-native';

import { flushMicrotasks } from '@test/flush-microtasks';

import { createFakePermissionAccess } from './fake-permissions';
import { createPermissionStatusMirror, watchAppActive } from './permission-status-mirror';

import type { PermissionState } from '@/core/permissions/permission-state';
import type { AppStateStatus } from 'react-native';

/** A foreground source the test moves by hand, with its listener count. */
function scriptedForeground(): {
  readonly watchActive: (onActive: () => void) => () => void;
  readonly comeBack: () => void;
  readonly watchers: () => number;
} {
  const watchers = new Set<() => void>();
  return {
    watchActive: (onActive) => {
      watchers.add(onActive);
      return () => {
        watchers.delete(onActive);
      };
    },
    comeBack: () => {
      for (const onActive of watchers) onActive();
    },
    watchers: () => watchers.size,
  };
}

/** A read the test answers by hand, to settle reads out of order. */
function deferredReads(): {
  readonly permission: () => Promise<PermissionState>;
  readonly answer: (index: number, state: PermissionState) => void;
} {
  const pending: ((state: PermissionState) => void)[] = [];
  return {
    permission: () =>
      new Promise((resolve) => {
        pending.push(resolve);
      }),
    answer: (index, state) => {
      pending[index]?.(state);
    },
  };
}

describe('createPermissionStatusMirror', () => {
  it('is unknown until the first subscriber makes it read', async () => {
    const access = createFakePermissionAccess({ platform: 'ios', state: 'blocked' });
    const foreground = scriptedForeground();
    const mirror = createPermissionStatusMirror({ access, onError: jest.fn(), ...foreground });

    expect(mirror.snapshot()).toBe('unknown');
    const unsubscribe = mirror.subscribe(jest.fn());
    await flushMicrotasks();

    expect(mirror.snapshot()).toBe('blocked');
    unsubscribe();
  });

  it('reads again when the app returns from Settings, and notifies only on a change', async () => {
    const access = createFakePermissionAccess({ platform: 'ios', state: 'blocked' });
    const foreground = scriptedForeground();
    const mirror = createPermissionStatusMirror({ access, onError: jest.fn(), ...foreground });
    const onChange = jest.fn();
    const unsubscribe = mirror.subscribe(onChange);
    await flushMicrotasks();
    foreground.comeBack();
    await flushMicrotasks();
    expect(onChange).toHaveBeenCalledTimes(1);

    access.setState('granted');
    foreground.comeBack();
    await flushMicrotasks();

    expect(mirror.snapshot()).toBe('granted');
    expect(onChange).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('keeps the latest answer when reads settle out of order', async () => {
    const reads = deferredReads();
    const foreground = scriptedForeground();
    const mirror = createPermissionStatusMirror({
      access: reads,
      onError: jest.fn(),
      ...foreground,
    });
    const unsubscribe = mirror.subscribe(jest.fn());
    foreground.comeBack();

    reads.answer(1, 'granted');
    reads.answer(0, 'undetermined');
    await flushMicrotasks();

    expect(mirror.snapshot()).toBe('granted');
    unsubscribe();
  });

  it('lets an answer the app holds win over a read still in flight', async () => {
    const reads = deferredReads();
    const mirror = createPermissionStatusMirror({
      access: reads,
      onError: jest.fn(),
      ...scriptedForeground(),
    });
    const unsubscribe = mirror.subscribe(jest.fn());

    mirror.set('granted');
    reads.answer(0, 'undetermined');
    await flushMicrotasks();

    expect(mirror.snapshot()).toBe('granted');
    unsubscribe();
  });

  it('stops watching and drops a pending read when the last subscriber leaves', async () => {
    const reads = deferredReads();
    const foreground = scriptedForeground();
    const mirror = createPermissionStatusMirror({
      access: reads,
      onError: jest.fn(),
      ...foreground,
    });
    const first = mirror.subscribe(jest.fn());
    const second = mirror.subscribe(jest.fn());
    first();
    expect(foreground.watchers()).toBe(1);

    second();
    reads.answer(0, 'granted');
    await flushMicrotasks();

    expect(foreground.watchers()).toBe(0);
    expect(mirror.snapshot()).toBe('unknown');
  });

  it('hands a failed read to onError', async () => {
    const failure = new Error('read failed');
    const onError = jest.fn();
    const mirror = createPermissionStatusMirror({
      access: { permission: () => Promise.reject(failure) },
      onError,
      ...scriptedForeground(),
    });

    const unsubscribe = mirror.subscribe(jest.fn());
    await flushMicrotasks();

    expect(onError).toHaveBeenCalledWith(failure);
    unsubscribe();
  });
});

describe('watchAppActive', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("calls back on 'active' only and removes its AppState listener", () => {
    const remove = jest.fn();
    const captured: { listener?: (state: AppStateStatus) => void } = {};
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      captured.listener = handler;
      return { remove };
    });
    const onActive = jest.fn();

    const stop = watchAppActive(onActive);
    captured.listener?.('inactive');
    captured.listener?.('active');
    stop();

    expect(onActive).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
