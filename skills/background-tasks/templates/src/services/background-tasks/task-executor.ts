// src/services/background-tasks/task-executor.ts
// Turns a BackgroundJob into the executor TaskManager.defineTask takes (the background-tasks skill
// owns this file). Every task the app defines goes through it, so no executor can throw: expo-task-
// manager only console.error()s a rejected executor, which nobody sees on a phone. The environment is
// created per run, inside the executor: on Android a run in a stopped process loads the bundle with
// the headless loader (no activity, no root layout, no providers), and on iOS nothing guarantees the
// root layout has created its services when the system fires the task. Every task type goes through
// it: the periodic expo-background-task run, and a notification or location task (its body's data and
// error reach the job as context.input and context.error). Its runs are recorded as `background`.
import { attempt } from '@/core/result';

import { isSuccessfulEnd, runBackgroundJob } from './background-job';

import type { BackgroundJob, JobEnvironment } from './background-job';

/**
 * expo-background-task's BackgroundTaskResult (Success = 1, Failed = 2 in 57.0.21,
 * BackgroundTask.types.ts) as plain numbers, so this file needs no SDK import; its test pins them.
 */
export const TASK_RESULT = { success: 1, failed: 2 } as const;

export type TaskResultValue = (typeof TASK_RESULT)[keyof typeof TASK_RESULT];

/**
 * The part of expo-task-manager's TaskManagerTaskBody an executor reads: `data` (empty for
 * expo-background-task, the payload of a notification or location task) and `error` (a
 * TaskManagerError `{ code, message }` when the system reports a failed event, else null).
 */
export type TaskBody = { readonly data: unknown; readonly error: unknown };

export type TaskExecutor = (body: TaskBody) => Promise<TaskResultValue>;

/** Releases what the environment opened for this run; a failure is recorded, never thrown. */
function disposeEnvironment<TDeps>(environment: JobEnvironment<TDeps>): void {
  const { dispose } = environment;
  if (dispose === undefined) return;
  const disposed = attempt(
    dispose,
    (thrown: unknown) => ({ kind: 'dispose-failed', thrown }) as const,
  );
  if (!disposed.ok) {
    environment.errorLog.record(
      'service',
      new Error('background environment not disposed', { cause: disposed.error.thrown }),
    );
  }
}

/**
 * The executor for `job`: creates the environment, runs the job once as a `background` run, disposes
 * the environment whatever the end, and maps the run's end to the task result. Resolves `failed`
 * when the environment cannot be created; never rejects.
 */
export function toTaskExecutor<TDeps>(
  job: BackgroundJob<TDeps>,
  createEnvironment: () => JobEnvironment<TDeps>,
): TaskExecutor {
  return async (body) => {
    // Nothing to record into when this fails: the error log is part of the environment. The task
    // result tells the system, and the run log shows no run for the developer to notice.
    const environment = attempt(
      createEnvironment,
      () => ({ kind: 'environment-unavailable' }) as const,
    );
    if (!environment.ok) return TASK_RESULT.failed;
    try {
      const record = await runBackgroundJob(job, environment.value, {
        trigger: 'background',
        input: body.data,
        error: body.error,
      });
      return isSuccessfulEnd(record.end) ? TASK_RESULT.success : TASK_RESULT.failed;
    } finally {
      disposeEnvironment(environment.value);
    }
  };
}
