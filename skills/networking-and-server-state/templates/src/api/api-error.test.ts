// src/api/api-error.test.ts
import { err, ok } from '@/core/result';

import { ApiError, apiFailureOf, unwrap } from './api-error';

describe('unwrap', () => {
  it('resolves with the value of an ok result', async () => {
    await expect(unwrap(Promise.resolve(ok(['a'])))).resolves.toStrictEqual(['a']);
  });

  it('rejects with an ApiError that carries the failure', async () => {
    const failure = { kind: 'not-found' } as const;
    const rejection = await unwrap(Promise.resolve(err(failure))).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(ApiError);
    expect(apiFailureOf(rejection)).toStrictEqual(failure);
  });
});

describe('apiFailureOf', () => {
  it('returns null for errors that are not ApiErrors', () => {
    expect([apiFailureOf(new TypeError('x is undefined')), apiFailureOf(null)]).toStrictEqual([
      null,
      null,
    ]);
  });

  it('names the kind in the message, never user text', () => {
    expect(new ApiError({ kind: 'server-unavailable', status: 503 }).message).toBe(
      'API request failed: server-unavailable',
    );
  });
});
