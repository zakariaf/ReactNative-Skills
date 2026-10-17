// src/api/create-query-client.test.ts
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { ApiError } from './api-error';
import {
  createQueryClient,
  MAX_QUERY_RETRIES,
  queryRetryDelay,
  shouldRetryQuery,
} from './create-query-client';

import type { QueryClient } from '@tanstack/react-query';

const OFFLINE = new ApiError({ kind: 'network-unavailable' });
const NOT_FOUND = new ApiError({ kind: 'not-found' });

describe('shouldRetryQuery', () => {
  it('retries a retryable failure up to the limit', () => {
    expect([0, 1, 2, 3].map((count) => shouldRetryQuery(count, OFFLINE))).toStrictEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(MAX_QUERY_RETRIES).toBe(3);
  });

  it('gives up at once on a final failure or a bug', () => {
    expect([shouldRetryQuery(0, NOT_FOUND), shouldRetryQuery(0, new TypeError('x'))]).toStrictEqual(
      [false, false],
    );
  });
});

describe('queryRetryDelay', () => {
  it('doubles from one second and stops at thirty', () => {
    expect([0, 1, 2, 5, 9].map((count) => queryRetryDelay(count, OFFLINE))).toStrictEqual([
      1000, 2000, 4000, 30_000, 30_000,
    ]);
  });

  it('waits what Retry-After asks, at most a minute', () => {
    const slowDown = (retryAfterMs: number): ApiError =>
      new ApiError({ kind: 'rate-limited', retryAfterMs });

    expect([
      queryRetryDelay(0, slowDown(5000)),
      queryRetryDelay(0, slowDown(600_000)),
    ]).toStrictEqual([5000, 60_000]);
  });
});

describe('createQueryClient', () => {
  // Every client a test makes is cleared afterwards, so no garbage-collection timer outlives it.
  const clients: QueryClient[] = [];
  const makeClient = (errorLog = createFakeErrorLog()): QueryClient => {
    const client = createQueryClient({ errorLog });
    clients.push(client);
    return client;
  };

  afterEach(() => {
    for (const client of clients.splice(0)) client.clear();
  });

  it('fails a query at once on a final failure', async () => {
    const queryClient = makeClient();
    let attempts = 0;
    const fetching = queryClient.query({
      queryKey: ['probe', 'final'],
      queryFn: () => {
        attempts += 1;
        return Promise.reject(NOT_FOUND);
      },
    });

    await expect(fetching).rejects.toBe(NOT_FOUND);
    expect(attempts).toBe(1);
  });

  it('records a bug in a queryFn once and leaves ApiFailures alone', async () => {
    const errorLog = createFakeErrorLog();
    const queryClient = makeClient(errorLog);
    const bug = new TypeError('cannot read title of undefined');
    await queryClient
      .query({ queryKey: ['probe', 'bug'], queryFn: () => Promise.reject(bug) })
      .catch(() => undefined);
    await queryClient
      .query({ queryKey: ['probe', 'api'], queryFn: () => Promise.reject(NOT_FOUND) })
      .catch(() => undefined);

    expect(errorLog.recorded.map((entry) => entry.error)).toStrictEqual([bug]);
  });

  it('keeps writes from retrying by default', () => {
    expect(makeClient().getDefaultOptions().mutations?.retry).toBe(false);
  });
});
