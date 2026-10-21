// packages/shared/src/core/result.ts
/** A value or a typed failure. */
export type Result<T, F> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: F };
