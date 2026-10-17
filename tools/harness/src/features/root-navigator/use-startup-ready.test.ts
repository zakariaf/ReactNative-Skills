// src/features/root-navigator/use-startup-ready.test.ts
// no-providers: the hook takes its gate and release function as arguments and reads no context.
import { act, renderHook } from '@testing-library/react-native';

import { ok } from '@/core/result';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { createStartupGate } from './startup-gate';
import { useStartupReady } from './use-startup-ready';

import type { StartupTask } from './startup-gate';

describe('useStartupReady', () => {
  it('releases the splash after the first commit when nothing blocks', async () => {
    const gate = createStartupGate({
      blocking: [],
      deadlineMs: 2000,
      errorLog: createFakeErrorLog(),
    });
    const releaseSplash = jest.fn();
    const { result } = await renderHook(() => useStartupReady(gate, releaseSplash));
    expect(result.current).toBe(true);
    expect(releaseSplash).toHaveBeenCalledTimes(1);
  });

  it('keeps the splash while a blocking task runs, then releases it once', async () => {
    let finish: () => void = () => undefined;
    const task: StartupTask = {
      name: 'session',
      run: () =>
        new Promise((resolve) => {
          finish = () => {
            resolve(ok(undefined));
          };
        }),
    };
    const gate = createStartupGate({
      blocking: [task],
      deadlineMs: 2000,
      errorLog: createFakeErrorLog(),
    });
    gate.start();
    const releaseSplash = jest.fn();
    const { result, rerender } = await renderHook(() => useStartupReady(gate, releaseSplash));
    expect(result.current).toBe(false);
    expect(releaseSplash).not.toHaveBeenCalled();

    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(result.current).toBe(true);
    await rerender({});
    expect(releaseSplash).toHaveBeenCalledTimes(1);
  });
});
