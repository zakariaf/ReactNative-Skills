// src/core/async/latest-request.test.ts
import { createLatestRequest } from './latest-request';

describe('createLatestRequest', () => {
  it('starts a request whose signal has not aborted', () => {
    const latest = createLatestRequest();

    expect(latest.start().aborted).toBe(false);
  });

  it('aborts the previous request when a newer one starts', () => {
    const latest = createLatestRequest();
    const first = latest.start();
    const second = latest.start();

    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
  });

  it('aborts the current request on cancel, and starts fresh afterwards', () => {
    const latest = createLatestRequest();
    const before = latest.start();
    latest.cancel();

    expect(before.aborted).toBe(true);
    expect(latest.start().aborted).toBe(false);
  });

  it('ignores a cancel with no request running', () => {
    const latest = createLatestRequest();

    expect(() => {
      latest.cancel();
    }).not.toThrow();
  });

  it('keeps the newest answer when the older request resolves last', async () => {
    const latest = createLatestRequest();
    const shown: string[] = [];
    const slow = Promise.withResolvers<string>();
    const fast = Promise.withResolvers<string>();
    const search = async (answer: Promise<string>): Promise<void> => {
      const signal = latest.start();
      const value = await answer;
      if (!signal.aborted) shown.push(value);
    };
    const first = search(slow.promise);
    const second = search(fast.promise);
    fast.resolve('tasks matching "ta"');
    await second;
    slow.resolve('tasks matching "t"');
    await first;

    expect(shown).toStrictEqual(['tasks matching "ta"']);
  });
});
