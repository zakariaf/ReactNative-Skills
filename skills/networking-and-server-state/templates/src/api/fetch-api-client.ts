// src/api/fetch-api-client.ts
// The ApiClient over fetch, and the only app file that calls fetch. In an Expo SDK 57 app the global
// fetch is expo/fetch on iOS and Android (NSURLSession / OkHttp); neither applies a per-request
// deadline here (Android's OkHttp client has connect, read and write timeouts of 0), so this client
// does. It never rejects: offline, timeouts, cancellation, HTTP errors and bodies that fail their
// schema all come back as ApiFailure values.
import * as v from 'valibot';

import { attemptAsync, err, ok } from '@/core/result';

import { buildUrl } from './build-url';
import { failureFromResponse, failureFromThrown, parseJson } from './to-api-failure';

import type { ApiClient, ApiRequest } from './api-client';
import type { ApiFailure } from './api-failure';
import type { Result } from '@/core/result';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

/** The part of a fetch response the client reads (the global Response satisfies it). */
export type FetchResponseLike = {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { readonly get: (name: string) => string | null };
  readonly text: () => Promise<string>;
};

export type FetchInit = {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal: AbortSignal;
};

/** fetch as the client calls it; tests pass a fake, the device passes deviceFetch. */
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponseLike>;

export type FetchApiClientOptions = {
  /** From src/config (per variant), never a literal here. */
  readonly baseUrl: string;
  readonly fetch: FetchLike;
  /** Records unexpected failures once: a body that is not JSON or fails its schema. */
  readonly errorLog: ErrorLogPort;
  /** The deadline for one attempt, response body included. Default DEFAULT_TIMEOUT_MS. */
  readonly timeoutMs?: number;
  /** Extra headers per request (the auth layer's Authorization); a rejection counts as unauthorized. */
  readonly headers?: () => Promise<Readonly<Record<string, string>>>;
};

export const DEFAULT_TIMEOUT_MS = 15_000;

/** The device's fetch: the global one (expo/fetch in an Expo SDK 57 app). */
export const deviceFetch: FetchLike = (url, init) => fetch(url, init);

type Received = {
  readonly isOk: boolean;
  readonly status: number;
  readonly retryAfter: string | null;
  readonly body: string;
};

type Attempt = {
  readonly url: string;
  readonly init: Omit<FetchInit, 'signal'>;
  readonly caller: AbortSignal | undefined;
  readonly timeoutMs: number;
};

/** A function, not a property read, so TypeScript does not narrow it across an await. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/** Sends one request and reads its body under one deadline linked to the caller's signal. */
async function receive(
  fetchFn: FetchLike,
  attempt: Attempt,
): Promise<Result<Received, ApiFailure>> {
  if (isAborted(attempt.caller)) return err({ kind: 'cancelled' });
  const controller = new AbortController();
  let isTimedOut = false;
  const abort = (): void => {
    controller.abort();
  };
  const timer = setTimeout(() => {
    isTimedOut = true;
    abort();
  }, attempt.timeoutMs);
  attempt.caller?.addEventListener('abort', abort);
  try {
    const response = await fetchFn(attempt.url, { ...attempt.init, signal: controller.signal });
    const body = await response.text();
    const retryAfter = response.headers.get('Retry-After');
    return ok({ isOk: response.ok, status: response.status, retryAfter, body });
  } catch {
    const isCancelled = isAborted(attempt.caller);
    return err(failureFromThrown({ isCancelled, isTimedOut, timeoutMs: attempt.timeoutMs }));
  } finally {
    clearTimeout(timer);
    attempt.caller?.removeEventListener('abort', abort);
  }
}

/** Checks a 2xx body against the request's schema; an empty body is checked as null. */
function toValue<TValue>(
  request: ApiRequest<TValue>,
  body: string,
  errorLog: ErrorLogPort,
): Result<TValue, ApiFailure> {
  const json = body.trim() === '' ? ok(null) : parseJson(body);
  const parsed = json.ok ? v.safeParse(request.schema, json.value) : null;
  if (parsed?.success === true) return ok(parsed.output);
  // Issue paths and expected types only: the received values can be the user's data.
  const where = parsed?.issues.map(
    (issue) => `${v.getDotPath(issue) ?? '(root)'} expected ${issue.expected ?? '?'}`,
  );
  const detail = where === undefined ? 'not JSON' : where.join('; ');
  errorLog.record(
    'network',
    new Error(`invalid response to ${request.method} ${request.path}: ${detail}`),
  );
  return err({ kind: 'invalid-response', path: request.path });
}

function headersFor(
  request: ApiRequest<unknown>,
  extra: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return {
    Accept: 'application/json',
    ...extra,
    ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(request.idempotencyKey === undefined ? {} : { 'Idempotency-Key': request.idempotencyKey }),
  };
}

/** Creates the app's ApiClient. The composition root calls it once with deviceFetch. */
export function createFetchApiClient(options: FetchApiClientOptions): ApiClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const readExtraHeaders = options.headers ?? (() => Promise.resolve({}));
  return {
    request: async (request) => {
      const url = buildUrl(options.baseUrl, request.path, request.query);
      const extra = await attemptAsync(readExtraHeaders, (thrown): ApiFailure => {
        options.errorLog.record('network', thrown);
        return { kind: 'unauthorized' };
      });
      if (!extra.ok) return extra;
      const headers = headersFor(request, extra.value);
      const init =
        request.body === undefined
          ? { method: request.method, headers }
          : { method: request.method, headers, body: JSON.stringify(request.body) };
      const received = await receive(options.fetch, {
        url,
        init,
        caller: request.signal,
        timeoutMs,
      });
      if (!received.ok) return received;
      const { isOk, status, retryAfter, body } = received.value;
      return isOk
        ? toValue(request, body, options.errorLog)
        : err(failureFromResponse({ status, retryAfter, body }));
    },
  };
}
