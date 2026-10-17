// src/features/root-navigator/startup-gate.ts
// The async work the first screen must wait for, under one deadline. Everything else at startup is
// synchronous (storage, settings, catalogs, embedded fonts), so most apps pass no blocking task and the
// gate is ready the moment it is created. A blocking task is the rare non-interactive async read the
// first screen is wrong without: the session restore (auth-and-secure-storage's restore(), which reads
// the keychain or keystore asynchronously; a miss starts the session as unknown or unavailable), or a
// file only an async API reads. Never a gate task: a biometric unlock, which waits for the person and
// cannot be bounded by a deadline (a lock screen or guard after the splash). The gate never rejects
// and never waits longer than the deadline: a task that fails or runs late is noted and the app opens
// anyway, because a splash that never goes away is worse than a screen that loads one thing late.
// Pure TypeScript: the root reads it through useStartupReady (useSyncExternalStore), tests drive it
// directly.
import { withTimeout } from '@/services/async/with-timeout';

import type { Result } from '@/core/result';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

/** An expected failure of a startup task: a kebab-case kind, as every failure in the app. */
export type StartupTaskFailure = { readonly kind: string };

/** One piece of async work the first screen needs. It receives the deadline's abort signal. */
export type StartupTask = {
  readonly name: string;
  readonly run: (signal: AbortSignal) => Promise<Result<unknown, StartupTaskFailure>>;
};

/** A task that did not finish in time or returned a failure; the app opened without it. */
export type StartupMiss = { readonly task: string; readonly kind: string };

export type StartupGate = {
  /** Starts the blocking tasks once; later calls do nothing. */
  readonly start: () => void;
  /** useSyncExternalStore's subscribe: called once when the gate becomes ready. */
  readonly subscribe: (onChange: () => void) => () => void;
  /** True once every blocking task finished, failed or ran out of time. */
  readonly isReady: () => boolean;
  /** What did not make it, once ready (empty when everything finished); null before. */
  readonly misses: () => readonly StartupMiss[] | null;
};

export type StartupGateOptions = {
  readonly blocking: readonly StartupTask[];
  /** One deadline for all blocking tasks, which run in parallel. Keep it at or under 3000 ms. */
  readonly deadlineMs: number;
  /** Records the unexpected: a task that ran out of time or threw (a bug: tasks return Results). */
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
};

/** Runs one task under the deadline: null when it finished, else what was missed. Never rejects. */
function taskRunner(
  deadlineMs: number,
  errorLog: Pick<ErrorLogPort, 'record'>,
): (task: StartupTask) => Promise<StartupMiss | null> {
  return async (task) => {
    try {
      const result = await withTimeout(task.run, deadlineMs);
      if (result.ok) return null;
      if (result.error.kind === 'timed-out') {
        errorLog.record(
          'startup',
          new Error(`startup task ${task.name} ran out of ${String(deadlineMs)} ms`),
        );
      }
      return { task: task.name, kind: result.error.kind };
    } catch (thrown: unknown) {
      errorLog.record('startup', new Error(`startup task ${task.name} threw`, { cause: thrown }));
      return { task: task.name, kind: 'threw' };
    }
  };
}

/** Calls every listener; one that throws is recorded and must not keep the others from hearing it. */
function notifyAll(
  listeners: ReadonlySet<() => void>,
  errorLog: Pick<ErrorLogPort, 'record'>,
): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (thrown: unknown) {
      errorLog.record('startup', new Error('a startup gate listener threw', { cause: thrown }));
    }
  });
}

export function createStartupGate({
  blocking,
  deadlineMs,
  errorLog,
}: StartupGateOptions): StartupGate {
  const listeners = new Set<() => void>();
  let misses: readonly StartupMiss[] | null = blocking.length === 0 ? [] : null;
  let hasStarted = false;
  const runOne = taskRunner(deadlineMs, errorLog);

  const settle = (next: readonly StartupMiss[]): void => {
    misses = next;
    notifyAll(listeners, errorLog);
  };

  return {
    start: () => {
      if (hasStarted || misses !== null) return;
      hasStarted = true;
      Promise.all(blocking.map(runOne))
        .then((results) => {
          settle(results.filter((miss): miss is StartupMiss => miss !== null));
        })
        .catch((thrown: unknown) => {
          // Unreachable by design (runOne and settle never throw); recorded, never swallowed.
          errorLog.record('startup', new Error('startup gate failed to settle', { cause: thrown }));
        });
    },
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    isReady: () => misses !== null,
    misses: () => misses,
  };
}
