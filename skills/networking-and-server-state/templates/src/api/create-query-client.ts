// src/api/create-query-client.ts
// The app's one TanStack Query client, made by a factory the root layout calls once (a useState
// initializer), never at module level: a module-level client outlives logout and Fast Refresh and is
// shared by every test file. Tests build their own (test/test-app.tsx: no retries, gcTime Infinity).
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { apiFailureOf } from './api-error';
import { isRetryableFailure } from './api-failure';

import type { ErrorLogPort } from '@/services/error-log/error-log-port';

/** Attempts after the first one, for failures that may pass later (TanStack's default count). */
export const MAX_QUERY_RETRIES = 3;
/** Data younger than this is fresh: mounting another screen with the same key does not refetch. */
export const DEFAULT_STALE_TIME_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * Retries a query only for failures a later attempt may cure (no connection, our deadline, 408, 429,
 * 5xx), at most MAX_QUERY_RETRIES times. TanStack's default retries every error three times, so a
 * 404 or a schema mismatch spins for about seven seconds before the screen shows it.
 */
export function shouldRetryQuery(failureCount: number, error: Error): boolean {
  const failure = apiFailureOf(error);
  return failure !== null && isRetryableFailure(failure) && failureCount < MAX_QUERY_RETRIES;
}

/** Waits what a 429's Retry-After asks (capped), else doubles from 1 s up to 30 s. */
export function queryRetryDelay(failureCount: number, error: Error): number {
  const failure = apiFailureOf(error);
  if (failure?.kind === 'rate-limited' && failure.retryAfterMs !== null) {
    return Math.min(failure.retryAfterMs, MAX_RETRY_AFTER_MS);
  }
  return Math.min(1000 * 2 ** failureCount, MAX_BACKOFF_MS);
}

export type QueryClientOptions = {
  /** Records errors that are not ApiFailures (a bug in a select or a queryFn), once per query. */
  readonly errorLog: ErrorLogPort;
};

/** Creates the app's QueryClient: failure-aware retries, a stale time, one place that records bugs. */
export function createQueryClient(options: QueryClientOptions): QueryClient {
  // ApiFailures were recorded (or deliberately not) at the ApiClient boundary; anything else is a bug.
  const recordBug = (error: Error): void => {
    if (apiFailureOf(error) === null) options.errorLog.record('network', error);
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError: recordBug }),
    mutationCache: new MutationCache({ onError: recordBug }),
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME_MS,
        retry: shouldRetryQuery,
        retryDelay: queryRetryDelay,
      },
      // Writes never retry by default: a retried POST without an idempotency key can apply twice.
      mutations: { retry: false },
    },
  });
}
