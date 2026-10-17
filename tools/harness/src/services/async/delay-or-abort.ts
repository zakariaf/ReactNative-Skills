// src/services/async/delay-or-abort.ts
// The one way the app waits (the async-safety skill owns this file): a pause that stops the moment
// its signal aborts and leaves nothing behind. `new Promise((resolve) => setTimeout(resolve, ms))`
// cannot be cancelled, so a retry loop or a poll keeps sleeping (and then acting) after the screen
// that started it is gone. Here the timer is cleared and the abort listener removed on both paths.
// React Native's AbortSignal is a polyfill (abort-controller 3.0.0): addEventListener ignores a
// `signal` option, so the listener is removed by hand.

/** How a wait ended. */
export type DelayOutcome = 'elapsed' | 'aborted';

/**
 * Resolves with 'elapsed' after `ms`, or with 'aborted' as soon as `signal` aborts (at once when
 * it already has). Never rejects; check the outcome and stop on 'aborted'.
 */
export function delayOrAbort(ms: number, signal?: AbortSignal): Promise<DelayOutcome> {
  if (signal?.aborted === true) return Promise.resolve('aborted');
  return new Promise((resolve) => {
    const finish = (outcome: DelayOutcome): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(outcome);
    };
    const onAbort = (): void => {
      finish('aborted');
    };
    const timer = setTimeout(() => {
      finish('elapsed');
    }, ms);
    signal?.addEventListener('abort', onAbort);
  });
}
