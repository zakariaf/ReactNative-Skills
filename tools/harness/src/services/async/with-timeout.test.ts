// src/services/async/with-timeout.test.ts
// allow-fake-timers: withTimeout is itself a timer; fake timers are the clock its deadline runs on.
import { err, ok } from '@/core/result';

import { withTimeout } from './with-timeout';

import type { Result } from '@/core/result';

type LoadFailure = { readonly kind: 'not-found' };

/** A task that settles only when the test says so, and remembers the signal it was given. */
function controllableTask(): {
  readonly task: (signal: AbortSignal) => Promise<Result<number, LoadFailure>>;
  readonly settle: (result: Result<number, LoadFailure>) => void;
  readonly received: () => AbortSignal | undefined;
} {
  const pending = Promise.withResolvers<Result<number, LoadFailure>>();
  let given: AbortSignal | undefined;
  return {
    task: (signal) => {
      given = signal;
      return pending.promise;
    },
    settle: pending.resolve,
    received: () => given,
  };
}

describe('withTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the task result when it settles before the deadline', async () => {
    const { task, settle } = controllableTask();
    const running = withTimeout(task, 1000);
    settle(ok(42));

    await expect(running).resolves.toStrictEqual({ ok: true, value: 42 });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('passes an expected failure of the task through', async () => {
    const { task, settle } = controllableTask();
    const running = withTimeout(task, 1000);
    settle(err({ kind: 'not-found' }));

    await expect(running).resolves.toStrictEqual({ ok: false, error: { kind: 'not-found' } });
  });

  it('returns timed-out at the deadline and aborts the abandoned task', async () => {
    const { task, received } = controllableTask();
    const running = withTimeout(task, 500);
    jest.advanceTimersByTime(500);

    await expect(running).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'timed-out', afterMs: 500 },
    });
    expect(received()?.aborted).toBe(true);
  });

  it('returns cancelled when the caller aborts first, aborts the task and clears its timer', async () => {
    const { task, received } = controllableTask();
    const caller = new AbortController();
    const removeListener = jest.spyOn(caller.signal, 'removeEventListener');
    const running = withTimeout(task, 60_000, caller.signal);
    caller.abort();

    await expect(running).resolves.toStrictEqual({ ok: false, error: { kind: 'cancelled' } });
    expect(received()?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('skips the task for a signal that has already aborted', async () => {
    const task = jest.fn<Promise<Result<number, LoadFailure>>, [AbortSignal]>();
    const caller = new AbortController();
    caller.abort();

    await expect(withTimeout(task, 1000, caller.signal)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'cancelled' },
    });
    expect(task).not.toHaveBeenCalled();
  });
});
