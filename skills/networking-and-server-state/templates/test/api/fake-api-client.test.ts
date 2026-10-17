// test/api/fake-api-client.test.ts
import * as v from 'valibot';

import { flushMicrotasks } from '@test/flush-microtasks';

import { createFakeApiClient } from './fake-api-client';

const TASK = v.object({ id: v.string() });

describe('createFakeApiClient', () => {
  it('answers through the request schema, like the real client', async () => {
    const api = createFakeApiClient();
    api.respond('GET', '/tasks/t1', { id: 't1', extra: 1 });
    api.respond('GET', '/tasks/t2', { id: 2 });

    await expect(
      api.request({ method: 'GET', path: '/tasks/t1', schema: TASK }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { id: 't1' },
    });
    await expect(
      api.request({ method: 'GET', path: '/tasks/t2', schema: TASK }),
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'invalid-response', path: '/tasks/t2' },
    });
  });

  it('uses answers in order and repeats the last one', async () => {
    const api = createFakeApiClient();
    api.fail('GET', '/tasks/t1', { kind: 'network-unavailable' });
    api.respond('GET', '/tasks/t1', { id: 't1' });
    const request = { method: 'GET', path: '/tasks/t1', schema: TASK } as const;
    const outcomes = [
      await api.request(request),
      await api.request(request),
      await api.request(request),
    ];

    expect(outcomes.map((outcome) => outcome.ok)).toStrictEqual([false, true, true]);
    expect(api.calls()).toHaveLength(3);
  });

  it('holds a request until the test releases it', async () => {
    const api = createFakeApiClient();
    const held = api.hold('PATCH', '/tasks/t1');
    let isSettled = false;
    const pending = api
      .request({ method: 'PATCH', path: '/tasks/t1', body: {}, schema: TASK })
      .finally(() => {
        isSettled = true;
      });
    await flushMicrotasks();
    const wasSettledBeforeRelease = isSettled;
    held.release({ failure: { kind: 'conflict', code: null } });

    expect(wasSettledBeforeRelease).toBe(false);
    await expect(pending).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'conflict', code: null },
    });
  });

  it('cancels a held request when its signal aborts', async () => {
    const api = createFakeApiClient();
    api.hold('GET', '/tasks');
    const controller = new AbortController();
    const pending = api.request({
      method: 'GET',
      path: '/tasks',
      schema: TASK,
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).resolves.toStrictEqual({ ok: false, error: { kind: 'cancelled' } });
  });

  it('rejects a request nobody scripted, naming it', async () => {
    const api = createFakeApiClient();

    await expect(
      api.request({ method: 'DELETE', path: '/tasks/t9', schema: TASK }),
    ).rejects.toThrow('no answer scripted for DELETE /tasks/t9');
  });
});
