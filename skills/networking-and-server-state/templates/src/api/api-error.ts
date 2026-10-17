// src/api/api-error.ts
// The bridge between the ApiClient's Results and TanStack Query, whose queryFn and mutationFn must
// reject for a query or mutation to enter its error state (and to be retried). The rejection carries
// the typed failure; model hooks read it back with apiFailureOf and switch on its kind.
import type { ApiFailure } from './api-failure';
import type { Result } from '@/core/result';

/** The rejection of a queryFn or mutationFn: the ApiFailure, never text for the UI. */
export class ApiError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(`API request failed: ${failure.kind}`);
    this.name = 'ApiError';
    this.failure = failure;
  }
}

/** The ApiFailure inside a query or mutation error, or null for anything else (a bug in a select). */
export function apiFailureOf(error: unknown): ApiFailure | null {
  return error instanceof ApiError ? error.failure : null;
}

/** Awaits a request and returns its value, or rejects with an ApiError: use it in queryFn/mutationFn. */
export async function unwrap<TValue>(
  request: Promise<Result<TValue, ApiFailure>>,
): Promise<TValue> {
  const result = await request;
  if (result.ok) return result.value;
  throw new ApiError(result.error);
}
