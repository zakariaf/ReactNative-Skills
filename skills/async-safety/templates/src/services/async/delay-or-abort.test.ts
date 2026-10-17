// src/services/async/delay-or-abort.test.ts
// allow-fake-timers: delayOrAbort is itself a timer; fake timers are the clock it waits on.
import { delayOrAbort } from './delay-or-abort';

describe('delayOrAbort', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves elapsed after the delay and leaves no timer behind', async () => {
    const waiting = delayOrAbort(1000);
    jest.advanceTimersByTime(1000);

    await expect(waiting).resolves.toBe('elapsed');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('resolves aborted as soon as the signal aborts, and clears its timer', async () => {
    const controller = new AbortController();
    const waiting = delayOrAbort(60_000, controller.signal);
    controller.abort();

    await expect(waiting).resolves.toBe('aborted');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('resolves aborted at once for a signal that has already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(delayOrAbort(1000, controller.signal)).resolves.toBe('aborted');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('removes its abort listener when the delay elapses', async () => {
    const controller = new AbortController();
    const removeListener = jest.spyOn(controller.signal, 'removeEventListener');
    const waiting = delayOrAbort(500, controller.signal);
    jest.advanceTimersByTime(500);

    await expect(waiting).resolves.toBe('elapsed');
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
