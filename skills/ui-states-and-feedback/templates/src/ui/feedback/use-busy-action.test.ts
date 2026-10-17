// src/ui/feedback/use-busy-action.test.ts
// no-providers: the hook reads no React context; the work and the error sink are its arguments.
import { act, renderHook } from '@testing-library/react-native';

import { useBusyAction } from './use-busy-action';

/** A promise the test settles by hand. */
function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe('useBusyAction', () => {
  it('is busy while the work runs and ignores a second press', async () => {
    const pending = deferred();
    const work = jest.fn(() => pending.promise);
    const view = await renderHook(() => useBusyAction(work, jest.fn()));
    await act(() => {
      view.result.current.start();
      view.result.current.start();
    });
    expect(view.result.current.isBusy).toBe(true);
    expect(work).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(view.result.current.isBusy).toBe(false);
  });

  it('reports an escaped rejection and becomes usable again', async () => {
    const pending = deferred();
    const onError = jest.fn();
    const view = await renderHook(() => useBusyAction(() => pending.promise, onError));
    await act(() => {
      view.result.current.start();
    });
    const failure = new Error('disk full');
    await act(async () => {
      pending.reject(failure);
      await pending.promise.catch(() => undefined);
    });
    expect(onError).toHaveBeenCalledWith(failure);
    expect(view.result.current.isBusy).toBe(false);
  });
});
