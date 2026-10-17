// src/services/async/with-timeout.ts
// A deadline that also stops the work it gives up on (the async-safety skill owns this file). The
// task receives a signal; when the deadline passes, or the caller's own signal aborts first, that
// signal aborts, so an abandoned fetch is cancelled instead of finishing (and writing) later. Running
// out of time and being cancelled are expected outcomes, so they travel as Result failures. Pair it
// with attemptAsync (src/core/result.ts) so the task itself never rejects:
//   withTimeout((signal) => attemptAsync(() => api.get(path, { signal }), toFailure), 8_000, outer)
import { err } from '@/core/result';

import type { Result } from '@/core/result';

/** The deadline passed before the task settled. */
export type TimedOut = { readonly kind: 'timed-out'; readonly afterMs: number };

/** The caller's signal aborted (the screen left, a newer call started) before the task settled. */
export type Cancelled = { readonly kind: 'cancelled' };

/**
 * Resolves with the task's Result, with `timed-out` after `afterMs`, or with `cancelled` when
 * `signal` aborts first; in both of the last two cases the signal the task received aborts too.
 * The timer is cleared and the listener removed however it ends. Never rejects unless `task` does.
 */
export async function withTimeout<TValue, TError>(
  task: (signal: AbortSignal) => Promise<Result<TValue, TError>>,
  afterMs: number,
  signal?: AbortSignal,
): Promise<Result<TValue, TError | TimedOut | Cancelled>> {
  if (signal?.aborted === true) return err({ kind: 'cancelled' });
  const controller = new AbortController();
  // Replaced synchronously below: a Promise executor runs before the constructor returns.
  let stop: (failure: TimedOut | Cancelled) => void = () => undefined;
  const stopped = new Promise<Result<never, TimedOut | Cancelled>>((resolve) => {
    stop = (failure) => {
      controller.abort();
      resolve(err(failure));
    };
  });
  const onAbort = (): void => {
    stop({ kind: 'cancelled' });
  };
  const timer = setTimeout(() => {
    stop({ kind: 'timed-out', afterMs });
  }, afterMs);
  signal?.addEventListener('abort', onAbort);
  try {
    return await Promise.race([task(controller.signal), stopped]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
