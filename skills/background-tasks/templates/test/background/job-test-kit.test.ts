// test/background/job-test-kit.test.ts
// The kit on a tiny counter job: three items, one per step, a stop check before each.
import { defineBackgroundJob } from '@/services/background-tasks/background-job';

import { runJobOnce, runJobTwice, runJobUntilAborted } from './job-test-kit';

type CounterDeps = { readonly pending: string[]; readonly done: string[] };

const COUNTER_JOB = defineBackgroundJob<CounterDeps>({
  name: 'tests.counter',
  budgetMs: 1_000,
  run: ({ deps, shouldStop }) => {
    let processed = 0;
    while (deps.pending.length > 0) {
      if (shouldStop()) return Promise.resolve({ kind: 'partial', processed });
      const item = deps.pending.shift();
      if (item !== undefined) deps.done.push(item);
      processed += 1;
    }
    return Promise.resolve({ kind: 'done', processed });
  },
});

function counterDeps(): CounterDeps {
  return { pending: ['a', 'b', 'c'], done: [] };
}

describe('job-test-kit', () => {
  it('runs the job to the end with runJobOnce', async () => {
    const deps = counterDeps();

    await expect(runJobOnce(COUNTER_JOB, deps, { input: 'unused' })).resolves.toStrictEqual({
      kind: 'done',
      processed: 3,
    });
    expect(deps.done).toStrictEqual(['a', 'b', 'c']);
  });

  it('gives the second run of runJobTwice the state the first left', async () => {
    const deps = counterDeps();

    const outcomes = await runJobTwice(COUNTER_JOB, deps);

    expect(outcomes).toStrictEqual([
      { kind: 'done', processed: 3 },
      { kind: 'done', processed: 0 },
    ]);
  });

  it('stops the job after the given number of checks with runJobUntilAborted', async () => {
    const deps = counterDeps();

    const stopped = await runJobUntilAborted(COUNTER_JOB, deps, 1);

    expect(stopped).toStrictEqual({
      outcome: { kind: 'partial', processed: 1 },
      checks: 2,
      sawStop: true,
    });
    expect([deps.done, deps.pending]).toStrictEqual([['a'], ['b', 'c']]);
  });

  it('hands the input and the error to the job, in full and cut runs alike', async () => {
    const seen: unknown[] = [];
    const payloadJob = defineBackgroundJob<CounterDeps>({
      name: 'tests.payload',
      budgetMs: 1_000,
      run: (context) => {
        seen.push([context.input, context.error]);
        return COUNTER_JOB.run(context);
      },
    });
    const error = { code: 1, message: 'location unavailable' };

    await runJobOnce(payloadJob, counterDeps());
    await runJobUntilAborted(payloadJob, counterDeps(), {
      stopAfterChecks: 0,
      input: { id: 'n1' },
      error,
    });

    expect(seen).toStrictEqual([
      [undefined, null],
      [{ id: 'n1' }, error],
    ]);
  });
});
