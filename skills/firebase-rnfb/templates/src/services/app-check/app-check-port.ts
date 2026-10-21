// src/services/app-check/app-check-port.ts
// App Check proves to Firestore, Storage and Functions that a request comes from this app on a real
// device. The composition root calls start() once, before the first Firestore, Storage or Functions
// call: a request sent earlier carries no token and fails once enforcement is on.
import type { Result } from '@/core/result';

export type AppCheckFailure = { readonly kind: 'app-check-start-failed'; readonly message: string };

export type AppCheckPort = {
  /** Starts the platform provider for this build; a second call does nothing. */
  readonly start: () => Result<void, AppCheckFailure>;
};
