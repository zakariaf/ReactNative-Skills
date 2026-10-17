// src/api/to-api-failure.test.ts
import {
  errorCodeOf,
  failureFromResponse,
  failureFromThrown,
  parseRetryAfterMs,
} from './to-api-failure';

const NO_BODY = { retryAfter: null, body: '' };

describe('failureFromResponse', () => {
  it.each([
    [401, { kind: 'unauthorized' }],
    [403, { kind: 'forbidden' }],
    [404, { kind: 'not-found' }],
    [410, { kind: 'not-found' }],
    [408, { kind: 'server-unavailable', status: 408 }],
    [500, { kind: 'server-unavailable', status: 500 }],
    [503, { kind: 'server-unavailable', status: 503 }],
    [400, { kind: 'rejected', status: 400, code: null }],
  ])('maps status %i', (status, failure) => {
    expect(failureFromResponse({ status, ...NO_BODY })).toStrictEqual(failure);
  });

  it('reads the error code of a 409 and a 422 body', () => {
    const body = '{"code":"title-taken","detail":"ignored"}';

    expect([
      failureFromResponse({ status: 409, retryAfter: null, body }),
      failureFromResponse({ status: 422, retryAfter: null, body }),
    ]).toStrictEqual([
      { kind: 'conflict', code: 'title-taken' },
      { kind: 'rejected', status: 422, code: 'title-taken' },
    ]);
  });

  it('honours a Retry-After in seconds on a 429', () => {
    expect(failureFromResponse({ status: 429, retryAfter: '3', body: '' })).toStrictEqual({
      kind: 'rate-limited',
      retryAfterMs: 3000,
    });
  });
});

describe('parseRetryAfterMs', () => {
  it('returns null for a missing header, an HTTP date and junk', () => {
    expect([
      parseRetryAfterMs(null),
      parseRetryAfterMs('Wed, 21 Oct 2026 07:28:00 GMT'),
      parseRetryAfterMs('-1'),
    ]).toStrictEqual([null, null, null]);
  });

  it('caps a huge delay at one hour', () => {
    expect(parseRetryAfterMs('999999')).toBe(3_600_000);
  });
});

describe('errorCodeOf', () => {
  it('returns null for HTML, JSON without a code and a non-string code', () => {
    expect([
      errorCodeOf('<html>Bad gateway</html>'),
      errorCodeOf('{"error":"x"}'),
      errorCodeOf('{"code":42}'),
    ]).toStrictEqual([null, null, null]);
  });
});

describe('failureFromThrown', () => {
  it('prefers cancelled over timed out over no connection', () => {
    expect([
      failureFromThrown({ isCancelled: true, isTimedOut: true, timeoutMs: 10 }),
      failureFromThrown({ isCancelled: false, isTimedOut: true, timeoutMs: 10 }),
      failureFromThrown({ isCancelled: false, isTimedOut: false, timeoutMs: 10 }),
    ]).toStrictEqual([
      { kind: 'cancelled' },
      { kind: 'timed-out', afterMs: 10 },
      { kind: 'network-unavailable' },
    ]);
  });
});
