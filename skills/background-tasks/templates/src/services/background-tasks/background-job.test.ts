// src/services/background-tasks/background-job.test.ts
// allow-fake-timers: the runner's budget is a withTimeout deadline; fake timers are its clock.
import { createFakeBackgroundRunLog } from '@/services/background-run-log/fake-background-run-log';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import {
  MAX_JOB_BUDGET_MS,
  defineBackgroundJob,
  isJobRunning,
  isSuccessfulEnd,
  runBackgroundJob,
  stopRunningJobs,
} from './background-job';

import type {
  BackgroundJob,
  JobContext,
  JobEnvironment,
  JobOutcome,
  RunRequest,
} from './background-job';

type Deps = { readonly label: string };

const BACKGROUND: RunRequest = { trigger: 'background' };

function environment(): JobEnvironment<Deps> & {
  readonly runLog: ReturnType<typeof createFakeBackgroundRunLog>;
  readonly errorLog: ReturnType<typeof createFakeErrorLog>;
} {
  let nowMs = 1_000;
  return {
    deps: { label: 'deps' },
    clock: {
      nowMs: () => {
        nowMs += 5;
        return nowMs;
      },
    },
    errorLog: createFakeErrorLog(),
    runLog: createFakeBackgroundRunLog(),
  };
}

function jobReturning(outcome: JobOutcome): BackgroundJob<Deps> {
  return defineBackgroundJob<Deps>({
    name: 'tasks.example',
    budgetMs: 1_000,
    run: () => Promise.resolve(outcome),
  });
}

/** A job whose run settles only when the test says so, and remembers its context. */
function controllableJob(): {
  readonly job: BackgroundJob<Deps>;
  readonly settle: (outcome: JobOutcome) => void;
  readonly context: () => JobContext<Deps> | undefined;
} {
  const pending = Promise.withResolvers<JobOutcome>();
  let seen: JobContext<Deps> | undefined;
  const job = defineBackgroundJob<Deps>({
    name: 'tasks.slow',
    budgetMs: 2_000,
    run: (context) => {
      seen = context;
      return pending.promise;
    },
  });
  return { job, settle: pending.resolve, context: () => seen };
}

describe('defineBackgroundJob', () => {
  it('accepts an <area>.<job> name and a budget within the cap', () => {
    const job = jobReturning({ kind: 'done', processed: 0 });

    expect([job.name, job.budgetMs, Object.isFrozen(job)]).toStrictEqual([
      'tasks.example',
      1_000,
      true,
    ]);
  });

  it.each(['sync', 'Tasks.sync', 'tasks.sync_outbox', 'tasks..sync', 'tasks.sync-'])(
    'rejects the name %s',
    (name) => {
      expect(() =>
        defineBackgroundJob({
          name,
          budgetMs: 1,
          run: () => Promise.resolve({ kind: 'done', processed: 0 }),
        }),
      ).toThrow('kebab-case');
    },
  );

  it.each([0, -1, 1.5, MAX_JOB_BUDGET_MS + 1])('rejects the budget %d', (budgetMs) => {
    expect(() =>
      defineBackgroundJob({
        name: 'tasks.example',
        budgetMs,
        run: () => Promise.resolve({ kind: 'done', processed: 0 }),
      }),
    ).toThrow('budgetMs');
  });
});

describe('runBackgroundJob', () => {
  it('passes the deps, the input and the error, and records a finished run', async () => {
    const env = environment();
    let seen: JobContext<Deps> | undefined;
    const job = defineBackgroundJob<Deps>({
      name: 'tasks.example',
      budgetMs: 1_000,
      run: (context) => {
        seen = context;
        return Promise.resolve({ kind: 'done', processed: 3 });
      },
    });

    const record = await runBackgroundJob(job, env, {
      trigger: 'background',
      input: { taskId: 7 },
      error: { code: 1, message: 'location unavailable' },
    });

    expect([seen?.deps, seen?.input, seen?.error, seen?.shouldStop()]).toStrictEqual([
      { label: 'deps' },
      { taskId: 7 },
      { code: 1, message: 'location unavailable' },
      false,
    ]);
    expect(record).toStrictEqual({
      name: 'tasks.example',
      trigger: 'background',
      startedAtMs: 1_005,
      finishedAtMs: 1_010,
      end: 'done',
      processed: 3,
      reason: null,
    });
    expect(env.runLog.records()).toStrictEqual([record]);
    expect(isJobRunning('tasks.example')).toBe(false);
  });

  it('records a foreground run under its own trigger, with no input and a null error', async () => {
    const env = environment();
    let seen: JobContext<Deps> | undefined;
    const job = defineBackgroundJob<Deps>({
      name: 'tasks.example',
      budgetMs: 1_000,
      run: (context) => {
        seen = context;
        return Promise.resolve({ kind: 'done', processed: 0 });
      },
    });

    const record = await runBackgroundJob(job, env, { trigger: 'foreground' });

    expect([seen?.input, seen?.error, record.trigger]).toStrictEqual([
      undefined,
      null,
      'foreground',
    ]);
  });

  it.each<{ outcome: JobOutcome; expected: readonly [string, number | null, string | null] }>([
    { outcome: { kind: 'partial', processed: 20 }, expected: ['partial', 20, null] },
    {
      outcome: { kind: 'deferred', reason: 'schema-behind' },
      expected: ['deferred', null, 'schema-behind'],
    },
    {
      outcome: { kind: 'failed', reason: 'server-unreachable' },
      expected: ['failed', null, 'server-unreachable'],
    },
  ])(
    'records the outcome $outcome.kind without logging an error',
    async ({ outcome, expected }) => {
      const env = environment();

      const record = await runBackgroundJob(jobReturning(outcome), env, BACKGROUND);

      expect([record.end, record.processed, record.reason]).toStrictEqual(expected);
      expect(env.errorLog.recorded).toStrictEqual([]);
    },
  );

  it('turns a throw into a crashed run and records the original error', async () => {
    const env = environment();
    const bug = new TypeError('row.id is undefined');
    const job = defineBackgroundJob<Deps>({
      name: 'tasks.example',
      budgetMs: 1_000,
      run: () => Promise.reject(bug),
    });

    const record = await runBackgroundJob(job, env, BACKGROUND);

    expect(record.end).toBe('crashed');
    expect(env.errorLog.recorded).toHaveLength(1);
    expect((env.errorLog.recorded[0]?.error as Error).cause).toBe(bug);
    // Error logs keep messages only, so the original message is part of the recorded one.
    expect((env.errorLog.recorded[0]?.error as Error).message).toBe(
      'background job tasks.example threw: row.id is undefined',
    );
  });

  it('answers overlapping while a run of the same job is going on, whatever started it', async () => {
    const env = environment();
    const { job, settle } = controllableJob();

    const first = runBackgroundJob(job, env, BACKGROUND);
    const second = await runBackgroundJob(job, env, { trigger: 'foreground' });
    settle({ kind: 'done', processed: 1 });

    expect([second.end, second.trigger, (await first).end]).toStrictEqual([
      'overlapping',
      'foreground',
      'done',
    ]);
    expect(isJobRunning('tasks.slow')).toBe(false);
  });

  describe('with fake timers', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('ends the run at its budget, aborts the job signal and records the defect', async () => {
      const env = environment();
      const { job, context } = controllableJob();

      const running = runBackgroundJob(job, env, BACKGROUND);
      await jest.advanceTimersByTimeAsync(2_000);
      const record = await running;

      expect([record.end, context()?.signal.aborted, context()?.shouldStop()]).toStrictEqual([
        'timed-out',
        true,
        true,
      ]);
      expect(env.errorLog.recorded).toHaveLength(1);
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  it('ends every run as cancelled when the system expiry calls stopRunningJobs', async () => {
    const env = environment();
    const { job, context } = controllableJob();

    const running = runBackgroundJob(job, env, BACKGROUND);
    const stopped = stopRunningJobs();
    const record = await running;

    expect([stopped, record.end, context()?.shouldStop()]).toStrictEqual([1, 'cancelled', true]);
    expect(stopRunningJobs()).toBe(0);
  });
});

describe('isSuccessfulEnd', () => {
  it('keeps the schedule for finished, continuing and skipped runs only', () => {
    const ends = [
      'done',
      'partial',
      'deferred',
      'overlapping',
      'failed',
      'timed-out',
      'cancelled',
      'crashed',
    ] as const;

    expect(ends.map((end) => isSuccessfulEnd(end))).toStrictEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });
});
