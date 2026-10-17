// src/api/api-failure-message.ts (example: the message table of the ApiFailure family)
// error-handling-typed-results owns the pattern: one table per failure family, keyed by kind, so a new
// kind is a compile error here; the UI never shows error.message. Every key exists in every catalog:
//   "api.failure.network-unavailable": "You're offline. We'll refresh when you're back online.",
//   "api.failure.timed-out": "The server is taking too long. Try again.",
//   "api.failure.unauthorized": "Your session ended. Sign in again.",
//   "api.failure.forbidden": "You don't have access to this.",
//   "api.failure.not-found": "This was deleted or moved.",
//   "api.failure.conflict": "This changed somewhere else. We've loaded the latest version.",
//   "api.failure.rate-limited": "Too many requests. Wait a moment and try again.",
//   "api.failure.server-unavailable": "The server is having trouble. Try again soon.",
//   "api.failure.rejected": "That didn't work. Check your input and try again.",
//   "api.failure.invalid-response": "Something went wrong on our side. Try again later."
// ('cancelled' is never shown: the screen that asked is gone.)
import type { ApiFailureKind } from './api-failure';
import type { MessageKey } from '@/i18n/messages';

/** The catalog key the UI shows for each failure kind; null for a kind nobody sees. */
export const API_FAILURE_MESSAGES = {
  'network-unavailable': 'api.failure.network-unavailable',
  'timed-out': 'api.failure.timed-out',
  cancelled: null,
  unauthorized: 'api.failure.unauthorized',
  forbidden: 'api.failure.forbidden',
  'not-found': 'api.failure.not-found',
  conflict: 'api.failure.conflict',
  'rate-limited': 'api.failure.rate-limited',
  'server-unavailable': 'api.failure.server-unavailable',
  rejected: 'api.failure.rejected',
  'invalid-response': 'api.failure.invalid-response',
} as const satisfies Readonly<Record<ApiFailureKind, MessageKey | null>>;
