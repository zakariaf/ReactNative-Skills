// src/canvas/describe-error.ts
'worklet';

/** Error → short text for the error log; safe on both runtimes (JS and UI). */
export function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
