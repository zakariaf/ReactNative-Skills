// src/api/fetch-api-client.test.ts
// The client against a fake fetch (lint bans the global fetch in tests, and no test reaches the
// network). The deadline tests use a 5 ms timeout and a fetch that waits for its signal: real time,
// no fake timers, no sleeps.
import * as v from 'valibot';

import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { flushMicrotasks } from '@test/flush-microtasks';

import { NO_CONTENT } from './api-client';
import { createFetchApiClient } from './fetch-api-client';

import type { FetchInit, FetchLike, FetchResponseLike } from './fetch-api-client';

type Call = { readonly url: string; readonly init: FetchInit };

const TASK = v.object({ id: v.string(), title: v.string() });
const BASE_URL = 'api.tasks.test/v1/';

function reply(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    text: () => Promise.resolve(body),
  };
}

/** A fetch that rejects once its signal aborts, like the real one, and never answers before. */
function waitForAbort(init: FetchInit): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = (): void => {
      reject(new Error('The operation was aborted.'));
    };
    if (init.signal.aborted) fail();
    else init.signal.addEventListener('abort', fail);
  });
}

function setUp(answer: (call: Call) => Promise<FetchResponseLike>, timeoutMs = 1000) {
  const calls: Call[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init });
    return answer({ url, init });
  };
  const errorLog = createFakeErrorLog();
  const api = createFetchApiClient({ baseUrl: BASE_URL, fetch, errorLog, timeoutMs });
  return { api, calls, errorLog };
}

describe('createFetchApiClient', () => {
  it('sends a GET below the base path and returns the validated body', async () => {
    const { api, calls } = setUp(() =>
      Promise.resolve(reply(200, '{"id":"t1","title":"Buy milk","extra":true}')),
    );
    const result = await api.request({
      method: 'GET',
      path: '/tasks/t1',
      query: { v: 2 },
      schema: TASK,
    });

    expect(result).toStrictEqual({ ok: true, value: { id: 't1', title: 'Buy milk' } });
    expect(calls.map((call) => [call.url, call.init.method, call.init.headers])).toStrictEqual([
      ['api.tasks.test/v1/tasks/t1?v=2', 'GET', { Accept: 'application/json' }],
    ]);
  });

  it('sends a JSON body with its content type and idempotency key', async () => {
    const { api, calls } = setUp(() =>
      Promise.resolve(reply(201, '{"id":"t2","title":"Call Sam"}')),
    );
    await api.request({
      method: 'POST',
      path: '/tasks',
      body: { title: 'Call Sam' },
      idempotencyKey: 'req-1',
      schema: TASK,
    });

    expect([calls[0]?.init.body, calls[0]?.init.headers]).toStrictEqual([
      '{"title":"Call Sam"}',
      {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'req-1',
      },
    ]);
  });

  it('checks an empty 204 body as null', async () => {
    const { api } = setUp(() => Promise.resolve(reply(204, '')));

    await expect(
      api.request({ method: 'DELETE', path: '/tasks/t1', schema: NO_CONTENT }),
    ).resolves.toStrictEqual({
      ok: true,
      value: null,
    });
  });

  it('turns a schema mismatch into invalid-response and records it once, without the data', async () => {
    const { api, errorLog } = setUp(() => Promise.resolve(reply(200, '{"id":"t1","title":42}')));
    const result = await api.request({ method: 'GET', path: '/tasks/t1', schema: TASK });

    expect(result).toStrictEqual({
      ok: false,
      error: { kind: 'invalid-response', path: '/tasks/t1' },
    });
    expect(errorLog.entries().map((entry) => [entry.source, entry.message])).toStrictEqual([
      ['network', 'invalid response to GET /tasks/t1: title expected string'],
    ]);
  });

  it('turns a 2xx that is not JSON into invalid-response', async () => {
    const { api, errorLog } = setUp(() => Promise.resolve(reply(200, '<html>portal</html>')));
    const result = await api.request({ method: 'GET', path: '/tasks', schema: TASK });

    expect(result).toStrictEqual({
      ok: false,
      error: { kind: 'invalid-response', path: '/tasks' },
    });
    expect(errorLog.entries()[0]?.message).toBe('invalid response to GET /tasks: not JSON');
  });

  it('maps HTTP errors without recording them', async () => {
    const { api, errorLog } = setUp(() => Promise.resolve(reply(429, '', { 'Retry-After': '2' })));
    const result = await api.request({ method: 'GET', path: '/tasks', schema: TASK });

    expect(result).toStrictEqual({
      ok: false,
      error: { kind: 'rate-limited', retryAfterMs: 2000 },
    });
    expect(errorLog.entries()).toStrictEqual([]);
  });

  it('turns a rejected fetch into network-unavailable', async () => {
    const { api } = setUp(() => Promise.reject(new TypeError('fetch failed: offline')));

    await expect(
      api.request({ method: 'GET', path: '/tasks', schema: TASK }),
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'network-unavailable' },
    });
  });

  it('cancels the request when the caller aborts', async () => {
    const { api, calls } = setUp(({ init }) => waitForAbort(init));
    const caller = new AbortController();
    const pending = api.request({
      method: 'GET',
      path: '/tasks',
      schema: TASK,
      signal: caller.signal,
    });
    await flushMicrotasks();
    caller.abort();

    await expect(pending).resolves.toStrictEqual({ ok: false, error: { kind: 'cancelled' } });
    expect(calls[0]?.init.signal.aborted).toBe(true);
  });

  it('does not call fetch for a caller that already aborted', async () => {
    const { api, calls } = setUp(() => Promise.resolve(reply(200, '{}')));
    const caller = new AbortController();
    caller.abort();

    await expect(
      api.request({ method: 'GET', path: '/tasks', schema: TASK, signal: caller.signal }),
    ).resolves.toStrictEqual({ ok: false, error: { kind: 'cancelled' } });
    expect(calls).toStrictEqual([]);
  });

  it('times out a request that never answers', async () => {
    const { api } = setUp(({ init }) => waitForAbort(init), 5);

    await expect(
      api.request({ method: 'GET', path: '/tasks', schema: TASK }),
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'timed-out', afterMs: 5 },
    });
  });

  it('times out a body that stalls after the headers arrived', async () => {
    const { api } = setUp(
      ({ init }) => Promise.resolve({ ...reply(200, ''), text: () => waitForAbort(init) }),
      5,
    );

    await expect(
      api.request({ method: 'GET', path: '/tasks', schema: TASK }),
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'timed-out', afterMs: 5 },
    });
  });

  it('adds the extra headers of every request', async () => {
    const calls: Call[] = [];
    const api = createFetchApiClient({
      baseUrl: BASE_URL,
      fetch: (url, init) => {
        calls.push({ url, init });
        return Promise.resolve(reply(200, '{"id":"t1","title":"x"}'));
      },
      errorLog: createFakeErrorLog(),
      headers: () => Promise.resolve({ Authorization: 'Bearer test-token' }),
    });
    await api.request({ method: 'GET', path: '/tasks/t1', schema: TASK });

    expect(calls[0]?.init.headers['Authorization']).toBe('Bearer test-token');
  });

  it('treats headers it cannot read as unauthorized, and records why', async () => {
    const errorLog = createFakeErrorLog();
    const failure = new Error('keychain locked');
    const api = createFetchApiClient({
      baseUrl: BASE_URL,
      fetch: () => Promise.resolve(reply(200, '{}')),
      errorLog,
      headers: () => Promise.reject(failure),
    });

    await expect(
      api.request({ method: 'GET', path: '/tasks', schema: TASK }),
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'unauthorized' },
    });
    expect(errorLog.recorded.map((entry) => entry.error)).toStrictEqual([failure]);
  });
});
