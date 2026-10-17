// src/core/result.ts (a fixture copy of the Result type error-handling-typed-results owns)

/** Outcome of an operation that can fail in an expected, recoverable way. */
export type Result<TValue, TError> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: TError };

/** Wraps a success value. */
export function ok<TValue>(value: TValue): Result<TValue, never> {
  return { ok: true, value };
}

/** Wraps an expected failure. `error` is a `kind`-discriminated union, never a string. */
export const err = <TError>(error: TError): Result<never, TError> => ({ ok: false, error });
