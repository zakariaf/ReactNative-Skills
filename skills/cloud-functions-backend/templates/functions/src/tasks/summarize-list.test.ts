// functions/src/tasks/summarize-list.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type CallableRequest, HttpsError } from 'firebase-functions/v2/https';

import type { QuotaDecision } from '../lib/daily-quota.ts';
import { makeSummarizeList } from './summarize-list.ts';
import type { SummaryOutcome } from './summary-provider.ts';

const NOW = new Date('2026-06-01T10:00:00.000Z');

function requestOf(payload: unknown): CallableRequest<unknown> {
  return {
    data: { apiVersion: 1, requestId: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b', payload },
    auth: { uid: 'user-1', token: {}, rawToken: 'token' },
    app: { appId: 'app', token: {}, alreadyConsumed: false },
    rawRequest: {},
    acceptsStreaming: false,
  } as unknown as CallableRequest<unknown>;
}

function harness(options: { enabled?: boolean; quota?: QuotaDecision; outcome?: SummaryOutcome; cached?: string } = {}) {
  const log: string[] = [];
  const callable = makeSummarizeList({
    flag: { enabled: () => (log.push('flag'), Promise.resolve(options.enabled ?? true)) },
    quota: {
      reserve: () => (log.push('reserve'), Promise.resolve(options.quota ?? { ok: true })),
      release: () => (log.push('release'), Promise.resolve()),
    },
    cache: {
      get: () => (log.push('cache-get'), Promise.resolve(options.cached ?? null)),
      put: () => (log.push('cache-put'), Promise.resolve()),
    },
    provider: { summarize: () => (log.push('provider'), Promise.resolve(options.outcome ?? { ok: true, summary: 'Two errands.' })) },
    now: () => NOW,
  });
  return { callable, log };
}

const payload = { listId: 'list-1', taskTitles: ['buy milk', 'call the bank'] };

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpsError);
    return error.code;
  }
  return 'ok';
}

describe('summarizeList', () => {
  it('serves a cached summary without the flag, the quota or the provider', async () => {
    const { callable, log } = harness({ cached: 'Cached.' });
    assert.deepEqual(await callable.run(requestOf(payload)), { ok: true, value: { summary: 'Cached.', cached: true } });
    assert.deepEqual(log, ['cache-get']);
  });

  it('reads the kill switch before the quota and the provider', async () => {
    const { callable, log } = harness({ enabled: false });
    assert.equal(await codeOf(callable.run(requestOf(payload))), 'failed-precondition');
    assert.deepEqual(log, ['cache-get', 'flag']);
  });

  it('returns quota-exceeded with its limit and reset time', async () => {
    const { callable, log } = harness({ quota: { ok: false, limit: 20, resetsAt: '2026-06-02T00:00:00.000Z' } });
    try {
      await callable.run(requestOf(payload));
      assert.fail('expected quota-exceeded');
    } catch (error) {
      assert.ok(error instanceof HttpsError);
      assert.equal(error.code, 'resource-exhausted');
      assert.deepEqual(error.details, { kind: 'quota-exceeded', params: { limit: 20, resetsAt: '2026-06-02T00:00:00.000Z' } });
    }
    assert.deepEqual(log, ['cache-get', 'flag', 'reserve']);
  });

  it('releases the reserved unit when the provider fails', async () => {
    const { callable, log } = harness({ outcome: { ok: false, reason: 'unavailable' } });
    assert.equal(await codeOf(callable.run(requestOf(payload))), 'unavailable');
    assert.deepEqual(log, ['cache-get', 'flag', 'reserve', 'provider', 'release']);
  });

  it('summarises, caches and counts one unit on success', async () => {
    const { callable, log } = harness();
    assert.deepEqual(await callable.run(requestOf(payload)), { ok: true, value: { summary: 'Two errands.', cached: false } });
    assert.deepEqual(log, ['cache-get', 'flag', 'reserve', 'provider', 'cache-put']);
  });

  it('rejects an empty list before any read', async () => {
    const { callable, log } = harness();
    assert.equal(await codeOf(callable.run(requestOf({ listId: 'list-1', taskTitles: [] }))), 'invalid-argument');
    assert.deepEqual(log, []);
  });
});
