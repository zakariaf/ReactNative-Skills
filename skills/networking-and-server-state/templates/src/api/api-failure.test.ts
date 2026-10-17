// src/api/api-failure.test.ts
import { isRetryableFailure } from './api-failure';

import type { ApiFailure } from './api-failure';

const RETRYABLE: readonly ApiFailure[] = [
  { kind: 'network-unavailable' },
  { kind: 'timed-out', afterMs: 15_000 },
  { kind: 'rate-limited', retryAfterMs: 2_000 },
  { kind: 'rate-limited', retryAfterMs: null },
  { kind: 'server-unavailable', status: 503 },
];

const FINAL: readonly ApiFailure[] = [
  { kind: 'cancelled' },
  { kind: 'unauthorized' },
  { kind: 'forbidden' },
  { kind: 'not-found' },
  { kind: 'conflict', code: null },
  { kind: 'rejected', status: 422, code: 'title-too-long' },
  { kind: 'invalid-response', path: '/tasks' },
];

describe('isRetryableFailure', () => {
  it.each(RETRYABLE)('retries $kind', (failure) => {
    expect(isRetryableFailure(failure)).toBe(true);
  });

  it.each(FINAL)('gives up on $kind', (failure) => {
    expect(isRetryableFailure(failure)).toBe(false);
  });
});
