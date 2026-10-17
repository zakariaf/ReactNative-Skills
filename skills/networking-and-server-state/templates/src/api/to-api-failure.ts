// src/api/to-api-failure.ts
// Pure conversions for the fetch client: an HTTP status (with its Retry-After header and body) to an
// ApiFailure, and a fetch rejection to one, decided by what the client knows (who aborted) instead of
// by error text: expo/fetch, React Native's fetch and Node's fetch word their errors differently.
import * as v from 'valibot';

import { attempt } from '@/core/result';

import type { ApiFailure } from './api-failure';
import type { Result } from '@/core/result';

const ERROR_BODY = v.object({ code: v.string() });
const MAX_RETRY_AFTER_MS = 60 * 60 * 1000;

/** Milliseconds from a Retry-After header in delta-seconds, else null (HTTP dates need a clock). */
export function parseRetryAfterMs(header: string | null): number | null {
  if (header === null || !/^\d+$/u.test(header.trim())) return null;
  return Math.min(Number(header.trim()) * 1000, MAX_RETRY_AFTER_MS);
}

/** The body parsed as JSON, or a failure for text that is not JSON (an HTML error page). */
export function parseJson(body: string): Result<unknown, { readonly kind: 'not-json' }> {
  return attempt(
    (): unknown => JSON.parse(body),
    () => ({ kind: 'not-json' }) as const,
  );
}

/** The `code` of a JSON error body such as {"code":"title-taken"}, else null. Never throws. */
export function errorCodeOf(body: string): string | null {
  const parsed = parseJson(body);
  if (!parsed.ok) return null;
  const result = v.safeParse(ERROR_BODY, parsed.value);
  return result.success ? result.output.code : null;
}

export type FailedResponse = {
  readonly status: number;
  readonly retryAfter: string | null;
  readonly body: string;
};

/** The failure for a response whose status is not 2xx. */
export function failureFromResponse({ status, retryAfter, body }: FailedResponse): ApiFailure {
  switch (status) {
    case 401:
      return { kind: 'unauthorized' };
    case 403:
      return { kind: 'forbidden' };
    case 404:
    case 410:
      return { kind: 'not-found' };
    case 409:
    case 412:
      return { kind: 'conflict', code: errorCodeOf(body) };
    case 429:
      return { kind: 'rate-limited', retryAfterMs: parseRetryAfterMs(retryAfter) };
    default:
      return status === 408 || status >= 500
        ? { kind: 'server-unavailable', status }
        : { kind: 'rejected', status, code: errorCodeOf(body) };
  }
}

export type ThrownContext = {
  /** The caller's signal was aborted (TanStack cancelled the query, the screen went away). */
  readonly isCancelled: boolean;
  /** The client's own deadline fired first. */
  readonly isTimedOut: boolean;
  readonly timeoutMs: number;
};

/** The failure for a rejected fetch (or body read): cancelled, timed out, or no connection. */
export function failureFromThrown(context: ThrownContext): ApiFailure {
  if (context.isCancelled) return { kind: 'cancelled' };
  if (context.isTimedOut) return { kind: 'timed-out', afterMs: context.timeoutMs };
  return { kind: 'network-unavailable' };
}
