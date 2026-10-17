// src/services/session/sign-out-steps.ts
// Runs the app's sign-out steps. The server steps run first, together, while the access token is
// still valid (unregister this device's push token, end the server session), under one short
// deadline, because a slow server must not hold the person on a screen they asked to leave. The
// local steps run after the wipe, in order. Each failure is recorded with the step's name and never
// stops the others: a cache or a registration left behind by one broken step would give the next
// person this person's data or notifications.
import { attemptAsync, ok } from '@/core/result';
import { withTimeout } from '@/services/async/with-timeout';

import type { ServerSignOutContext, ServerSignOutStep, SignOutStep } from './session-types';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

/** The whole server phase gets this long; then sign-out goes on without the steps still running. */
export const SERVER_SIGN_OUT_TIMEOUT_MS = 5_000;

type ErrorLog = Pick<ErrorLogPort, 'record'>;

/** Resolves with the names of the steps that failed (empty when all ran); never rejects. */
export async function runSignOutSteps(
  steps: readonly SignOutStep[],
  errorLog: ErrorLog,
): Promise<readonly string[]> {
  const failed: string[] = [];
  for (const step of steps) {
    const done = await attemptAsync(
      async () => {
        await step.run();
      },
      (thrown) => thrown,
    );
    if (!done.ok) {
      failed.push(step.name);
      errorLog.record(
        'service',
        new Error(`sign-out step ${step.name} failed`, { cause: done.error }),
      );
    }
  }
  return failed;
}

/**
 * Runs every server step at once with the still-valid token. Resolves with the names of the steps
 * that failed or did not finish before the deadline (their signal aborts); never rejects.
 */
export type ServerSignOutRun = {
  /** The access token of the session that is ending (still valid). */
  readonly accessToken: string;
  readonly errorLog: ErrorLog;
  /** Default SERVER_SIGN_OUT_TIMEOUT_MS. */
  readonly timeoutMs?: number;
};

export async function runServerSignOutSteps(
  steps: readonly ServerSignOutStep[],
  { accessToken, errorLog, timeoutMs = SERVER_SIGN_OUT_TIMEOUT_MS }: ServerSignOutRun,
): Promise<readonly string[]> {
  const unfinished = new Set(steps.map((step) => step.name));
  const failed: string[] = [];
  const runOne = async (step: ServerSignOutStep, context: ServerSignOutContext): Promise<void> => {
    const done = await attemptAsync(
      async () => {
        await step.run(context);
      },
      (thrown) => thrown,
    );
    // A step that settles at or after the deadline (its signal aborted) is reported as unfinished
    // below, once; a later failure is not recorded again.
    const isInTime = !context.signal.aborted && unfinished.delete(step.name);
    if (isInTime && !done.ok) {
      failed.push(step.name);
      errorLog.record(
        'service',
        new Error(`server sign-out step ${step.name} failed`, { cause: done.error }),
      );
    }
  };
  const outcome = await withTimeout(async (signal) => {
    await Promise.all(steps.map((step) => runOne(step, { accessToken, signal })));
    return ok(undefined);
  }, timeoutMs);
  if (!outcome.ok) {
    for (const name of unfinished) {
      failed.push(name);
      errorLog.record(
        'service',
        new Error(`server sign-out step ${name} did not finish within ${String(timeoutMs)} ms`),
      );
    }
  }
  return failed;
}
