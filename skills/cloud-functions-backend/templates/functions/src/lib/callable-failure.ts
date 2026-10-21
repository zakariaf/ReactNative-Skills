// functions/src/lib/callable-failure.ts
// The one list of typed failures a callable can return, and the one place they become HttpsError codes.
// The client reads `details.kind` (and `details.params`), never the message, so messages stay generic.
import { type FunctionsErrorCode, HttpsError } from 'firebase-functions/v2/https';

export type CallableFailure =
  | { kind: 'unauthenticated' }
  | { kind: 'app-check-failed' }
  | { kind: 'invalid-input' }
  | { kind: 'quota-exceeded'; params: { limit: number; resetsAt: string } }
  | { kind: 'service-paused' }
  | { kind: 'unavailable' }
  | { kind: 'internal' };

export type CallableFailureKind = CallableFailure['kind'];

export const CALLABLE_FAILURE_KINDS: readonly CallableFailureKind[] = [
  'unauthenticated',
  'app-check-failed',
  'invalid-input',
  'quota-exceeded',
  'service-paused',
  'unavailable',
  'internal',
];

export function httpsCodeFor(kind: CallableFailureKind): FunctionsErrorCode {
  switch (kind) {
    case 'unauthenticated':
      return 'unauthenticated';
    case 'app-check-failed':
      return 'permission-denied';
    case 'invalid-input':
      return 'invalid-argument';
    case 'quota-exceeded':
      return 'resource-exhausted';
    case 'service-paused':
      return 'failed-precondition';
    case 'unavailable':
      return 'unavailable';
    case 'internal':
      return 'internal';
    default: {
      const unhandled: never = kind;
      throw new Error(`Unhandled failure kind: ${String(unhandled)}`);
    }
  }
}

export function toHttpsError(failure: CallableFailure): HttpsError {
  return new HttpsError(httpsCodeFor(failure.kind), failure.kind, failure);
}
