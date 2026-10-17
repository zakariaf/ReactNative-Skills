// src/services/background-tasks/jobs/sync-outbox-job.ts
// Example (Tasks app): sends the changes a user made offline, oldest first, in bounded batches.
// It is safe to run twice and safe to cut anywhere:
//   - each change carries its id as the server's idempotency key, so a change sent twice (sent, then
//     the window ended before markSynced committed) is applied once;
//   - markSynced commits per change, so a cut run leaves every finished change finished;
//   - shouldStop() is asked before each change, and the signal goes to the request;
//   - a change the server refuses for good (a 4xx other than 408 and 429) is set aside for the user
//     (markRejected) and the run goes on: left pending, it would be first in line on every run and
//     block every change behind it. A retryable failure (offline, 5xx, 408, 429) leaves it pending.
// The foreground path (use-sync-outbox-on-foreground.ts) runs the same job through the same runner.
import { defineBackgroundJob } from '@/services/background-tasks/background-job';

import type { Result } from '@/core/result';
import type { JobOutcome } from '@/services/background-tasks/background-job';

/** One pending change of the outbox table (persistence-and-migrations owns the table). */
export type OutboxChange = { readonly id: string; readonly payload: unknown };

export type OutboxFailure =
  { readonly kind: 'outbox-unreadable' } | { readonly kind: 'outbox-unwritable' };

export type SendFailure =
  | { readonly kind: 'offline' }
  | { readonly kind: 'rejected'; readonly status: number }
  | { readonly kind: 'cancelled' };

export type SyncOutboxDeps = {
  /** null when the database is not at the current schema: the job then defers (never migrates). */
  readonly outbox: {
    readonly pendingChanges: (limit: number) => Result<readonly OutboxChange[], OutboxFailure>;
    readonly markSynced: (id: string) => Result<void, OutboxFailure>;
    /** A state transition to `rejected` (the user resolves it), never a delete. */
    readonly markRejected: (id: string, status: number) => Result<void, OutboxFailure>;
  } | null;
  /** The ApiClient call (networking-and-server-state): `id` is the idempotency key. */
  readonly sender: {
    readonly send: (
      change: OutboxChange,
      signal: AbortSignal,
    ) => Promise<Result<void, SendFailure>>;
  };
};

/** Changes per run: a batch small enough to finish well inside the budget on a slow network. */
export const SYNC_OUTBOX_BATCH = 20;

/**
 * True when sending the same request again cannot succeed: a client error, except 408 (timeout) and
 * 429 (rate limited), which say "later".
 */
export function isPermanentRejection(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

type Outbox = NonNullable<SyncOutboxDeps['outbox']>;

/** One change handled: go on with the next, or end the run with this outcome. */
type Step = { readonly kind: 'next' } | JobOutcome;

function committed(result: Result<void, OutboxFailure>): Step {
  return result.ok ? { kind: 'next' } : { kind: 'failed', reason: result.error.kind };
}

function outcomeOfSendFailure(failure: SendFailure, processed: number): JobOutcome {
  switch (failure.kind) {
    case 'offline':
      return { kind: 'deferred', reason: 'offline' };
    case 'cancelled':
      return { kind: 'partial', processed };
    case 'rejected':
      return { kind: 'failed', reason: `server-rejected-${String(failure.status)}` };
  }
}

async function syncChange(
  change: OutboxChange,
  context: { readonly outbox: Outbox; readonly sender: SyncOutboxDeps['sender'] },
  run: { readonly signal: AbortSignal; readonly processed: number },
): Promise<Step> {
  const sent = await context.sender.send(change, run.signal);
  if (sent.ok) return committed(context.outbox.markSynced(change.id));
  const failure = sent.error;
  if (failure.kind === 'rejected' && isPermanentRejection(failure.status)) {
    return committed(context.outbox.markRejected(change.id, failure.status));
  }
  return outcomeOfSendFailure(failure, run.processed);
}

export const syncOutboxJob = defineBackgroundJob<SyncOutboxDeps>({
  name: 'tasks.sync-outbox',
  budgetMs: 20_000,
  run: async ({ deps, signal, shouldStop }) => {
    if (deps.outbox === null) return { kind: 'deferred', reason: 'schema-behind' };
    const pending = deps.outbox.pendingChanges(SYNC_OUTBOX_BATCH);
    if (!pending.ok) return { kind: 'failed', reason: pending.error.kind };
    let processed = 0;
    // One change at a time, oldest first: the server applies them in the order the user made them.
    const context = { outbox: deps.outbox, sender: deps.sender };
    for (const change of pending.value) {
      if (shouldStop()) return { kind: 'partial', processed };
      const step = await syncChange(change, context, { signal, processed });
      if (step.kind !== 'next') return step;
      processed += 1;
    }
    return pending.value.length === SYNC_OUTBOX_BATCH
      ? { kind: 'partial', processed }
      : { kind: 'done', processed };
  },
});
