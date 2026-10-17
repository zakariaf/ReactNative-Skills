// src/api/api-client.ts
// The ApiClient port: the only way app code talks to the app's server. A request names its method,
// path and the schema its response must match; the answer is a Result, never a rejection. Adapter:
// fetch-api-client.ts (the one file that calls fetch). Fake: fake-api-client.ts.
import * as v from 'valibot';

import type { ApiFailure } from './api-failure';
import type { Result } from '@/core/result';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Query-string values; `undefined` leaves the parameter out. */
export type QueryParams = Readonly<Record<string, string | number | boolean | undefined>>;

/** The schema a response body is checked against; its output becomes the request's value. */
export type ResponseSchema<TValue> = v.GenericSchema<unknown, TValue>;

/** One request. Build it in src/api/<resource>/ only (queryOptions and mutationOptions). */
export type ApiRequest<TValue> = {
  readonly method: HttpMethod;
  /** Below the base URL, starting with '/': '/tasks/' + encodeURIComponent(id). */
  readonly path: string;
  readonly query?: QueryParams;
  /** A JSON body for POST, PUT and PATCH; sent with Content-Type: application/json. */
  readonly body?: unknown;
  /** Checks the parsed body (an empty body is checked as null; use NO_CONTENT for 204). */
  readonly schema: ResponseSchema<TValue>;
  /** TanStack Query's signal (queryFn context): aborting it cancels the request. */
  readonly signal?: AbortSignal;
  /** Sent as Idempotency-Key, so the server applies a retried write once. */
  readonly idempotencyKey?: string;
};

/** The app's server, as a port. `request` never rejects: every outcome is a Result. */
export type ApiClient = {
  readonly request: <TValue>(request: ApiRequest<TValue>) => Promise<Result<TValue, ApiFailure>>;
};

/** The schema of a response without a body (204 No Content, or an empty 200). */
export const NO_CONTENT = v.null();
