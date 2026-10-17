// src/services/background-tasks/jobs/sync-outbox-job.test.ts
// The job against an in-memory outbox and a server that applies each idempotency key once.
import { err, ok } from '@/core/result';
import { runJobOnce, runJobTwice, runJobUntilAborted } from '@test/background/job-test-kit';

import { isPermanentRejection, syncOutboxJob } from './sync-outbox-job';

import type { OutboxChange, SyncOutboxDeps } from './sync-outbox-job';

type Harness = {
  readonly deps: SyncOutboxDeps;
  readonly pending: () => readonly string[];
  readonly rejected: () => readonly string[];
  readonly applied: () => readonly string[];
  readonly requests: () => number;
};

function harness(
  ids: readonly string[],
  options: {
    readonly failMarkOnce?: string;
    /** The status the server answers for these ids, every time. */
    readonly rejectWith?: Readonly<Record<string, number>>;
  } = {},
): Harness {
  const outbox = new Map<string, OutboxChange>(ids.map((id) => [id, { id, payload: { id } }]));
  const rejected = new Map<string, number>();
  const applied = new Set<string>();
  let requests = 0;
  let failMark = options.failMarkOnce;
  return {
    deps: {
      outbox: {
        pendingChanges: (limit) => ok([...outbox.values()].slice(0, limit)),
        markSynced: (id) => {
          if (id === failMark) {
            failMark = undefined;
            return err({ kind: 'outbox-unwritable' });
          }
          outbox.delete(id);
          return ok(undefined);
        },
        markRejected: (id, status) => {
          outbox.delete(id);
          rejected.set(id, status);
          return ok(undefined);
        },
      },
      sender: {
        send: (change) => {
          requests += 1;
          const status = options.rejectWith?.[change.id];
          if (status !== undefined) return Promise.resolve(err({ kind: 'rejected', status }));
          applied.add(change.id); // the server dedupes by idempotency key
          return Promise.resolve(ok(undefined));
        },
      },
    },
    pending: () => [...outbox.keys()],
    rejected: () => [...rejected.keys()],
    applied: () => [...applied],
    requests: () => requests,
  };
}

describe('syncOutboxJob', () => {
  it('sends every pending change once, and a second run changes nothing', async () => {
    const app = harness(['c1', 'c2', 'c3']);

    const outcomes = await runJobTwice(syncOutboxJob, app.deps);

    expect(outcomes).toStrictEqual([
      { kind: 'done', processed: 3 },
      { kind: 'done', processed: 0 },
    ]);
    expect([app.pending(), app.applied(), app.requests()]).toStrictEqual([
      [],
      ['c1', 'c2', 'c3'],
      3,
    ]);
  });

  it('keeps every finished change finished when stopped mid-run, and the next run finishes', async () => {
    const app = harness(['c1', 'c2', 'c3']);

    const stopped = await runJobUntilAborted(syncOutboxJob, app.deps, 1);

    expect([stopped.outcome, stopped.sawStop]).toStrictEqual([
      { kind: 'partial', processed: 1 },
      true,
    ]);
    expect(app.pending()).toStrictEqual(['c2', 'c3']);
    await expect(runJobOnce(syncOutboxJob, app.deps)).resolves.toStrictEqual({
      kind: 'done',
      processed: 2,
    });
  });

  it('applies a change once when the window ended between send and markSynced', async () => {
    const app = harness(['c1'], { failMarkOnce: 'c1' });

    const first = await runJobOnce(syncOutboxJob, app.deps);
    const second = await runJobOnce(syncOutboxJob, app.deps);

    expect([first, second]).toStrictEqual([
      { kind: 'failed', reason: 'outbox-unwritable' },
      { kind: 'done', processed: 1 },
    ]);
    expect([app.applied(), app.requests()]).toStrictEqual([['c1'], 2]);
  });

  it('sets a change the server refuses for good aside and sends the ones behind it', async () => {
    const app = harness(['c1', 'c2'], { rejectWith: { c1: 422 } });

    const outcomes = await runJobTwice(syncOutboxJob, app.deps);

    expect(outcomes).toStrictEqual([
      { kind: 'done', processed: 2 },
      { kind: 'done', processed: 0 },
    ]);
    expect([app.pending(), app.rejected(), app.applied()]).toStrictEqual([[], ['c1'], ['c2']]);
  });

  it('leaves a change pending when the server says later (5xx, 408, 429)', async () => {
    const app = harness(['c1', 'c2'], { rejectWith: { c1: 503 } });

    const outcome = await runJobOnce(syncOutboxJob, app.deps);

    expect([outcome, app.pending(), app.rejected()]).toStrictEqual([
      { kind: 'failed', reason: 'server-rejected-503' },
      ['c1', 'c2'],
      [],
    ]);
    expect(
      [408, 429, 500, 400, 404, 409].map((status) => isPermanentRejection(status)),
    ).toStrictEqual([false, false, false, true, true, true]);
  });

  it('defers without touching anything while the schema is behind', async () => {
    const app = harness(['c1']);

    const outcome = await runJobOnce(syncOutboxJob, { ...app.deps, outbox: null });

    expect([outcome, app.requests()]).toStrictEqual([
      { kind: 'deferred', reason: 'schema-behind' },
      0,
    ]);
  });
});
