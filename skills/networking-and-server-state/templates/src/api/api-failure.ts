// src/api/api-failure.ts
// The failure family of the ApiClient boundary: every way a request can end without a usable value,
// as a kebab-case kind with typed params (never text, an Error or a status code alone). The UI maps
// each kind to a message key; the retry policy reads isRetryableFailure.

/** Why a request produced no value. */
export type ApiFailure =
  /** No HTTP response at all: offline, DNS, TLS, connection refused or reset. */
  | { readonly kind: 'network-unavailable' }
  /** The app's own deadline passed before the response (and its body) arrived. */
  | { readonly kind: 'timed-out'; readonly afterMs: number }
  /** The caller aborted (screen left, newer query, logout): never shown, never recorded. */
  | { readonly kind: 'cancelled' }
  /** 401: the session is missing or expired; the auth layer decides what happens next. */
  | { readonly kind: 'unauthorized' }
  /** 403: signed in, but not allowed. */
  | { readonly kind: 'forbidden' }
  /** 404 (or 410): the resource does not exist (any more). */
  | { readonly kind: 'not-found' }
  /** 409 or 412: the write lost a race with another change; refetch, then let the user decide. */
  | { readonly kind: 'conflict'; readonly code: string | null }
  /** 429: slow down; `retryAfterMs` from a Retry-After header in seconds, else null. */
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number | null }
  /** 408 or 5xx: the server could not answer now; a later attempt may succeed. */
  | { readonly kind: 'server-unavailable'; readonly status: number }
  /** Any other 4xx: the server refused this request as sent; `code` from a JSON `{ code }` body. */
  | { readonly kind: 'rejected'; readonly status: number; readonly code: string | null }
  /** A 2xx whose body was not JSON or did not match the schema (recorded once at the boundary). */
  | { readonly kind: 'invalid-response'; readonly path: string };

export type ApiFailureKind = ApiFailure['kind'];

const RETRYABLE: ReadonlySet<ApiFailureKind> = new Set<ApiFailureKind>([
  'network-unavailable',
  'timed-out',
  'rate-limited',
  'server-unavailable',
]);

/**
 * True for failures a later identical attempt may cure: no connection, our deadline, 429, 408 and
 * 5xx. A 4xx (except 408 and 429), an invalid body and a cancellation never retry: repeating them
 * gives the same answer.
 */
export function isRetryableFailure(failure: ApiFailure): boolean {
  return RETRYABLE.has(failure.kind);
}
