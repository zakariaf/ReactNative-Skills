// src/services/background-tasks/task-executor.test.ts
// allow-fake-timers: the timed-out case runs the runner's withTimeout deadline on fake timers.
import { createFakeBackgroundRunLog } from '@/services/background-run-log/fake-background-run-log';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { defineBackgroundJob } from './background-job';
import { TASK_RESULT, toTaskExecutor } from './task-executor';

import type { BackgroundJob, JobEnvironment, JobOutcome } from './background-job';

type Seen = { readonly input: unknown; readonly error: unknown };

type Deps = { readonly seen: Seen[] };

type TestEnvironment = JobEnvironment<Deps> & {
  readonly errorLog: ReturnType<typeof createFakeErrorLog>;
  readonly runLog: ReturnType<typeof createFakeBackgroundRunLog>;
  readonly disposed: () => number;
};

function jobReturning(outcome: () => Promise<JobOutcome>): BackgroundJob<Deps> {
  return defineBackgroundJob<Deps>({
    name: 'tasks.example',
    budgetMs: 1_000,
    run: (context) => {
      context.deps.seen.push({ input: context.input, error: context.error });
      return outcome();
    },
  });
}

function testEnvironment(options: { readonly failDispose?: boolean } = {}): TestEnvironment {
  let disposed = 0;
  return {
    deps: { seen: [] },
    clock: { nowMs: () => 0 },
    errorLog: createFakeErrorLog(),
    runLog: createFakeBackgroundRunLog(),
    dispose: () => {
      disposed += 1;
      if (options.failDispose === true) throw new Error('database is locked');
    },
    disposed: () => disposed,
  };
}

type BackgroundTaskModule = {
  readonly BackgroundTaskResult: { readonly Success: number; readonly Failed: number };
};

describe('TASK_RESULT', () => {
  it('equals expo-background-task BackgroundTaskResult', () => {
    const { BackgroundTaskResult } =
      jest.requireActual<BackgroundTaskModule>('expo-background-task');

    expect(TASK_RESULT).toStrictEqual({
      success: BackgroundTaskResult.Success,
      failed: BackgroundTaskResult.Failed,
    });
  });
});

describe('toTaskExecutor', () => {
  it('runs the job with the task data and error as a background run, and answers success', async () => {
    const env = testEnvironment();
    const execute = toTaskExecutor(
      jobReturning(() => Promise.resolve({ kind: 'done', processed: 1 })),
      () => env,
    );
    const error = { code: 'E_LOCATION_UNAVAILABLE', message: 'no fix' };

    await expect(execute({ data: { reason: 'push' }, error })).resolves.toBe(TASK_RESULT.success);
    expect(env.deps.seen).toStrictEqual([{ input: { reason: 'push' }, error }]);
    expect(env.runLog.records().map((record) => record.trigger)).toStrictEqual(['background']);
    expect(env.disposed()).toBe(1);
  });

  it('answers failed for a failed or crashed run, disposes after both, and never rejects', async () => {
    const failedEnv = testEnvironment();
    const crashedEnv = testEnvironment();
    const failed = toTaskExecutor(
      jobReturning(() => Promise.resolve({ kind: 'failed', reason: 'server-unreachable' })),
      () => failedEnv,
    );
    const crashed = toTaskExecutor(
      jobReturning(() => Promise.reject(new Error('bug'))),
      () => crashedEnv,
    );

    await expect(failed({ data: undefined, error: null })).resolves.toBe(TASK_RESULT.failed);
    await expect(crashed({ data: undefined, error: null })).resolves.toBe(TASK_RESULT.failed);
    expect([failedEnv.disposed(), crashedEnv.disposed()]).toStrictEqual([1, 1]);
    expect(crashedEnv.runLog.records().map((record) => record.end)).toStrictEqual(['crashed']);
  });

  it('records a failed dispose and keeps the task result', async () => {
    const env = testEnvironment({ failDispose: true });
    const execute = toTaskExecutor(
      jobReturning(() => Promise.resolve({ kind: 'done', processed: 0 })),
      () => env,
    );

    await expect(execute({ data: undefined, error: null })).resolves.toBe(TASK_RESULT.success);
    expect(env.errorLog.recorded.map((entry) => entry.source)).toStrictEqual(['service']);
    expect((env.errorLog.recorded[0]?.error as Error).message).toBe(
      'background environment not disposed',
    );
  });

  it('answers failed when the environment cannot be created', async () => {
    const execute = toTaskExecutor(
      jobReturning(() => Promise.resolve({ kind: 'done', processed: 0 })),
      () => {
        throw new Error('kv-store unavailable');
      },
    );

    await expect(execute({ data: undefined, error: null })).resolves.toBe(TASK_RESULT.failed);
  });

  describe('with fake timers', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('disposes after a run that outran its budget', async () => {
      const env = testEnvironment();
      const never = Promise.withResolvers<JobOutcome>();
      const execute = toTaskExecutor(
        jobReturning(() => never.promise),
        () => env,
      );

      const result = execute({ data: undefined, error: null });
      await jest.advanceTimersByTimeAsync(1_000);

      await expect(result).resolves.toBe(TASK_RESULT.failed);
      expect([env.runLog.records()[0]?.end, env.disposed()]).toStrictEqual(['timed-out', 1]);
    });
  });
});
