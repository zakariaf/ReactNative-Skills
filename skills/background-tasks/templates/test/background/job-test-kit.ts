// test/background/job-test-kit.ts
// Runs a background job directly, without the runner, the way its tests must: twice in a row (the
// second run must change nothing: idempotent) and cut short after a number of shouldStop() checks
// (what is committed stays consistent; a later run finishes the rest). Every job's test calls both;
// the background-tasks checker's job-tested rule looks for them.
import type {
  BackgroundJob,
  JobContext,
  JobOutcome,
} from '@/services/background-tasks/background-job';

export type JobRunOptions = {
  /** The task body's data, as a notification or location task receives it. */
  readonly input?: unknown;
  /** The task body's error (a TaskManagerError), as a location task may receive it; default null. */
  readonly error?: unknown;
};

export type StoppedRun = {
  readonly outcome: JobOutcome;
  /** How often the job asked shouldStop() in this run. */
  readonly checks: number;
  /** True when the job saw shouldStop() turn true (it asked often enough to be stopped). */
  readonly sawStop: boolean;
};

function contextFor<TDeps>(
  deps: TDeps,
  options: JobRunOptions,
  stopAfterChecks: number | null,
): { readonly context: JobContext<TDeps>; readonly checks: () => number } {
  const controller = new AbortController();
  let checks = 0;
  const shouldStop = (): boolean => {
    checks += 1;
    if (stopAfterChecks !== null && checks > stopAfterChecks) controller.abort();
    return controller.signal.aborted;
  };
  const context: JobContext<TDeps> = {
    deps,
    input: options.input,
    error: options.error ?? null,
    signal: controller.signal,
    shouldStop,
  };
  return { context, checks: () => checks };
}

/** One full run with a signal that never aborts. */
export function runJobOnce<TDeps>(
  job: BackgroundJob<TDeps>,
  deps: TDeps,
  options: JobRunOptions = {},
): Promise<JobOutcome> {
  return job.run(contextFor(deps, options, null).context);
}

/** Two full runs over the same deps; assert the second changed nothing the first did not. */
export async function runJobTwice<TDeps>(
  job: BackgroundJob<TDeps>,
  deps: TDeps,
  options: JobRunOptions = {},
): Promise<readonly [JobOutcome, JobOutcome]> {
  const first = await runJobOnce(job, deps, options);
  const second = await runJobOnce(job, deps, options);
  return [first, second];
}

/** When to stop, plus the task body a payload job receives (its cut path is tested with input). */
export type StopRunOptions = JobRunOptions & { readonly stopAfterChecks: number };

/**
 * One run whose shouldStop() answers false `stopAfterChecks` times, then true (and aborts the
 * signal), as when the budget runs out or the system ends the window mid-run. Pass a number, or
 * `{ stopAfterChecks, input, error }` for a job that reads the task body.
 */
export async function runJobUntilAborted<TDeps>(
  job: BackgroundJob<TDeps>,
  deps: TDeps,
  stop: number | StopRunOptions,
): Promise<StoppedRun> {
  const options: StopRunOptions = typeof stop === 'number' ? { stopAfterChecks: stop } : stop;
  const { stopAfterChecks } = options;
  const { context, checks } = contextFor(deps, options, stopAfterChecks);
  const outcome = await job.run(context);
  return { outcome, checks: checks(), sawStop: checks() > stopAfterChecks };
}
