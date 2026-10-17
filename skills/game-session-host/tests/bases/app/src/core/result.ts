// src/core/result.ts
// The one Result type of the app (the error-handling-typed-results skill owns it; every layer imports
// it from here). An expected failure travels as a value, { ok: false, error }, where `error` is a
// failure: a kebab-case `kind` plus typed params, never a string, an Error or user-facing text.
// Pure TypeScript: no React, React Native or Expo imports.

/** Outcome of an operation that can fail in an expected, recoverable way. */
export type Result<TValue, TError> =
  { readonly ok: true; readonly value: TValue } | { readonly ok: false; readonly error: TError };

/** Wraps a success value. */
export function ok<TValue>(value: TValue): Result<TValue, never> {
  return { ok: true, value };
}

/** Wraps an expected failure. `error` is a `kind`-discriminated union, never a string. */
export function err<TError>(error: TError): Result<never, TError> {
  return { ok: false, error };
}

/**
 * Runs `run` and turns a throw into an expected failure through `toFailure`. Use it at a boundary,
 * around one vendor call. `toFailure` must be total: a mapper that throws defeats the conversion.
 */
export function attempt<TValue, TError>(
  run: () => TValue,
  toFailure: (thrown: unknown) => TError,
): Result<TValue, TError> {
  try {
    return ok(run());
  } catch (thrown: unknown) {
    return err(toFailure(thrown));
  }
}

/**
 * Awaits `task()` and resolves with a Result. It takes a function, not a promise, so a synchronous
 * throw while starting the task is converted too. Never rejects while `toFailure` is total.
 */
export async function attemptAsync<TValue, TError>(
  task: () => Promise<TValue>,
  toFailure: (thrown: unknown) => TError,
): Promise<Result<TValue, TError>> {
  try {
    return ok(await task());
  } catch (thrown: unknown) {
    return err(toFailure(thrown));
  }
}
