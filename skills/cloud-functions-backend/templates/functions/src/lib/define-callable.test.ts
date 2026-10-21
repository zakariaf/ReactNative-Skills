// functions/src/lib/define-callable.test.ts
// Runs with Node's test runner (type stripping): node --test "src/**/*.test.ts"
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import * as v from 'valibot';

import { CALLABLE_FAILURE_KINDS, httpsCodeFor } from './callable-failure.ts';
import { defineCallable, uidHash } from './define-callable.ts';

const REQUEST_ID = '0b7e7f8e-3c1a-4d6e-9a43-0c2f4f2f8a11';

function requestOf(data: unknown, options: { uid?: string; consumed?: boolean } = {}): CallableRequest<unknown> {
  const request = { data, rawRequest: {}, acceptsStreaming: false } as unknown as CallableRequest<unknown>;
  if (options.uid !== undefined) request.auth = { uid: options.uid, token: {}, rawToken: 'token' } as unknown as NonNullable<CallableRequest['auth']>;
  if (options.consumed !== undefined) request.app = { appId: 'app', token: {}, alreadyConsumed: options.consumed } as unknown as NonNullable<CallableRequest['app']>;
  return request;
}

function echoCallable(handler: (title: string) => Promise<string> = (title) => Promise.resolve(title.toUpperCase()), consume = false) {
  let calls = 0;
  const callable = defineCallable({
    name: 'echoTitle',
    input: v.object({ title: v.pipe(v.string(), v.minLength(1)) }),
    consumeAppCheckToken: consume,
    handler: async ({ title }) => {
      calls += 1;
      return { ok: true, value: await handler(title) };
    },
  });
  return { callable, calls: () => calls };
}

async function failureOf(promise: Promise<unknown>): Promise<HttpsError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpsError, 'expected an HttpsError');
    return error;
  }
  assert.fail('expected the call to fail');
}

const valid = { apiVersion: 1, requestId: REQUEST_ID, payload: { title: 'buy milk' } };

describe('defineCallable', () => {
  it('returns the value in an ok envelope for a signed-in caller with valid input', async () => {
    const { callable } = echoCallable();
    assert.deepEqual(await callable.run(requestOf(valid, { uid: 'user-1' })), { ok: true, value: 'BUY MILK' });
  });

  it('rejects a caller without auth before any work', async () => {
    const { callable, calls } = echoCallable();
    const error = await failureOf(callable.run(requestOf(valid)));
    assert.equal(error.code, 'unauthenticated');
    assert.deepEqual(error.details, { kind: 'unauthenticated' });
    assert.equal(calls(), 0);
  });

  it('rejects an already consumed App Check token on a cost-bearing callable', async () => {
    const { callable, calls } = echoCallable(undefined, true);
    const error = await failureOf(callable.run(requestOf(valid, { uid: 'user-1', consumed: true })));
    assert.equal(error.code, 'permission-denied');
    assert.equal(calls(), 0);
  });

  it('rejects a bad envelope and a bad payload without calling the handler', async () => {
    const { callable, calls } = echoCallable();
    for (const data of [{ ...valid, requestId: 'nope' }, { ...valid, apiVersion: 2 }, { ...valid, payload: { title: '' } }, 'text']) {
      const error = await failureOf(callable.run(requestOf(data, { uid: 'user-1' })));
      assert.equal(error.code, 'invalid-argument');
    }
    assert.equal(calls(), 0);
  });

  it('turns an unexpected throw into internal without leaking its message', async () => {
    const { callable } = echoCallable(() => Promise.reject(new Error('provider said: secret user text')));
    const error = await failureOf(callable.run(requestOf(valid, { uid: 'user-1' })));
    assert.equal(error.code, 'internal');
    assert.equal(error.message, 'internal');
    assert.deepEqual(error.details, { kind: 'internal' });
  });
});

describe('httpsCodeFor', () => {
  const expected = {
    unauthenticated: 'unauthenticated',
    'app-check-failed': 'permission-denied',
    'invalid-input': 'invalid-argument',
    'quota-exceeded': 'resource-exhausted',
    'service-paused': 'failed-precondition',
    unavailable: 'unavailable',
    internal: 'internal',
  } as const;

  for (const kind of CALLABLE_FAILURE_KINDS) {
    it(`maps ${kind} to ${expected[kind]}`, () => {
      assert.equal(httpsCodeFor(kind), expected[kind]);
    });
  }
});

describe('uidHash', () => {
  it('is stable and never contains the uid', () => {
    assert.equal(uidHash('user-1'), uidHash('user-1'));
    assert.notEqual(uidHash('user-1'), uidHash('user-2'));
    assert.ok(!uidHash('user-1').includes('user-1'));
  });
});
