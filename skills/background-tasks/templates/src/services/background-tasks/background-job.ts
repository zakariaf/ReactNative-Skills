// src/services/background-tasks/background-job.ts
// The contract every background job keeps and the one runner that executes it, in a background
// launch and on the foreground path alike (the background-tasks skill owns this file). A job is a
// short, idempotent unit of work with a time budget: it checks shouldStop() between steps, commits
// each step on its own, and can be cut anywhere, because the operating system ends background
// windows without warning. The runner gives each run its deadline, lets only one run of a job go at
// a time, turns a throw into a recorded 'crashed' end, and writes the run log. It never throws.
import { attempt, attemptAsync } from '@/core/result';
import { withTimeout } from '@/services/async/with-timeout';

import type {
  BackgroundRunLogPort,
  BackgroundRunRecord,
  RunEnd,
  RunTrigger,
} from '@/services/background-run-log/background-run-log-port';
import type { ClockPort } from '@/services/clock/clock-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

/**
 * The longest budget a job may ask for. iOS gives a background window of seconds to minutes and
 * may end it at any moment; 25 s fits inside the shortest window either platform grants, with time
 * left to commit and record.
 */
export const MAX_JOB_BUDGET_MS = 25_000;

/** `<area>.<job>`, kebab-case segments: tasks.sync-outbox, reminders.refresh-schedule. */
const JOB_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/u;

/** What a job reports. `reason` is a kebab-case id (server-unreachable), never text or user data. */
export type JobOutcome =
  | { readonly kind: 'done'; readonly processed: number }
  | { readonly kind: 'partial'; readonly processed: number }
  | { readonly kind: 'deferred'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string };

export type JobContext<TDeps> = {
  readonly deps: TDeps;
  /**
   * The task body's data: a notification task's payload, a location task's `{ locations }`;
   * undefined for expo-background-task and on the foreground path. Validate it (valibot) in the job.
   */
  readonly input: unknown;
  /**
   * The task body's error (expo-task-manager's TaskManagerError, `{ code, message }`), set when the
   * system reports a failed location or geofencing event; null for expo-background-task and on the
   * foreground path. A job that receives one returns an outcome for it, never ignores it.
   */
  readonly error: unknown;
  /** Hand it to every call that takes one (the ApiClient, a SQLite read): it aborts at the budget. */
  readonly signal: AbortSignal;
  /** Ask between steps; true once the budget ran out or the system ended the window. */
  readonly shouldStop: () => boolean;
};

export type BackgroundJob<TDeps> = {
  readonly name: string;
  readonly budgetMs: number;
  readonly run: (context: JobContext<TDeps>) => Promise<JobOutcome>;
};

/** What a run needs besides the job: created per run, never from React context. */
export type JobEnvironment<TDeps> = {
  readonly deps: TDeps;
  readonly clock: Pick<ClockPort, 'nowMs'>;
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
  readonly runLog: Pick<BackgroundRunLogPort, 'append'>;
  /**
   * Releases what the environment opened for this run only (a database connection). toTaskExecutor
   * calls it once the run ended, whatever the end; runBackgroundJob never does, because a foreground
   * caller passes the app's own long-lived services.
   */
  readonly dispose?: () => void;
};

/** How a run was started, and what the task body carried (see JobContext). */
export type RunRequest = {
  readonly trigger: RunTrigger;
  readonly input?: unknown;
  readonly error?: unknown;
};

type Crashed = { readonly kind: 'crashed'; readonly thrown: unknown };

/** The runs going on in this process, by job name: one at a time per job. */
const running = new Map<string, AbortController>();

/** Validates a job once, where it is declared. A bad name or budget is a bug, so it throws. */
export function defineBackgroundJob<TDeps>(job: BackgroundJob<TDeps>): BackgroundJob<TDeps> {
  if (!JOB_NAME.test(job.name)) {
    throw new Error(`background job name "${job.name}" is not <area>.<job> in kebab-case`);
  }
  if (!Number.isInteger(job.budgetMs) || job.budgetMs <= 0 || job.budgetMs > MAX_JOB_BUDGET_MS) {
    throw new Error(`background job ${job.name}: budgetMs must be 1..${String(MAX_JOB_BUDGET_MS)}`);
  }
  return Object.freeze({ ...job });
}

const SUCCESSFUL_END: Readonly<Record<RunEnd, boolean>> = {
  done: true,
  partial: true,
  deferred: true,
  overlapping: true,
  failed: false,
  'timed-out': false,
  cancelled: false,
  crashed: false,
};

/** True when the system should keep its normal schedule (the work is done or will continue). */
export function isSuccessfulEnd(end: RunEnd): boolean {
  return SUCCESSFUL_END[end];
}

/** True while a run of `name` is going on in this process. */
export function isJobRunning(name: string): boolean {
  return running.has(name);
}

/** Ends every run in this process (the system's expiry signal); returns how many were running. */
export function stopRunningJobs(): number {
  const count = running.size;
  for (const controller of running.values()) controller.abort();
  return count;
}

type Ending = Pick<BackgroundRunRecord, 'end' | 'processed' | 'reason'>;

function endingOf(outcome: JobOutcome): Ending {
  switch (outcome.kind) {
    case 'done':
    case 'partial':
      return { end: outcome.kind, processed: outcome.processed, reason: null };
    case 'deferred':
    case 'failed':
      return { end: outcome.kind, processed: null, reason: outcome.reason };
  }
}

/**
 * The thrown value's message, never throwing. It goes into the recorded error's own message because
 * error logs store messages only: a crash read on a debug screen later shows what the job threw.
 */
function messageOf(thrown: unknown): string {
  const read = attempt(
    () => {
      const message: unknown =
        typeof thrown === 'object' && thrown !== null ? Reflect.get(thrown, 'message') : undefined;
      return typeof message === 'string' ? message : String(thrown);
    },
    () => ({ kind: 'unprintable' }) as const,
  );
  return read.ok ? read.value : 'unprintable error';
}

function finish<TDeps>(
  environment: JobEnvironment<TDeps>,
  record: BackgroundRunRecord,
): BackgroundRunRecord {
  environment.runLog.append(record);
  return record;
}

async function execute<TDeps>(
  job: BackgroundJob<TDeps>,
  environment: JobEnvironment<TDeps>,
  context: { readonly request: RunRequest; readonly outer: AbortSignal },
): Promise<Ending> {
  const result = await withTimeout(
    (signal) =>
      attemptAsync(
        () =>
          job.run({
            deps: environment.deps,
            input: context.request.input,
            error: context.request.error ?? null,
            signal,
            shouldStop: () => signal.aborted,
          }),
        (thrown): Crashed => ({ kind: 'crashed', thrown }),
      ),
    job.budgetMs,
    context.outer,
  );
  if (result.ok) return endingOf(result.value);
  switch (result.error.kind) {
    case 'crashed':
      environment.errorLog.record(
        'service',
        new Error(`background job ${job.name} threw: ${messageOf(result.error.thrown)}`, {
          cause: result.error.thrown,
        }),
      );
      return { end: 'crashed', processed: null, reason: null };
    case 'timed-out':
    case 'cancelled':
      return { end: result.error.kind, processed: null, reason: null };
  }
}

/**
 * Runs `job` once within its budget and resolves with the record it appended to the run log, under
 * the request's trigger. A second call while a run of the same job is going on (whatever started
 * it) resolves at once with `overlapping`. The foreground path passes `{ trigger: 'foreground' }`;
 * only toTaskExecutor passes `background`.
 */
export async function runBackgroundJob<TDeps>(
  job: BackgroundJob<TDeps>,
  environment: JobEnvironment<TDeps>,
  request: RunRequest,
): Promise<BackgroundRunRecord> {
  const startedAtMs = environment.clock.nowMs();
  const base = { name: job.name, trigger: request.trigger, startedAtMs };
  if (running.has(job.name)) {
    const ending: Ending = { end: 'overlapping', processed: null, reason: null };
    return finish(environment, { ...base, ...ending, finishedAtMs: startedAtMs });
  }
  const controller = new AbortController();
  running.set(job.name, controller);
  try {
    const ending = await execute(job, environment, { request, outer: controller.signal });
    // A job that outran its budget never asked shouldStop() in time: a defect, so it is recorded.
    // A 'failed' end is expected (offline, server down) and lives in the run log only.
    if (ending.end === 'timed-out') {
      environment.errorLog.record('service', new Error(`background job ${job.name} timed out`));
    }
    return finish(environment, { ...base, ...ending, finishedAtMs: environment.clock.nowMs() });
  } finally {
    running.delete(job.name);
  }
}
