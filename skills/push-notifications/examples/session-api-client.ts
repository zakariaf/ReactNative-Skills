// src/api/session-api-client.ts
// The signed-in ApiClient, created before the session exists. It breaks a cycle: the composition
// root creates services first; the session (createAppSession) comes later and needs
// services.pushRegistration for its push-registration sign-out step, while that registration's
// registrar needs the signed-in client (auth-and-secure-storage's createAuthorizedApiClient), which
// needs the session. This client exists from the start, answers 'unauthorized' without a request
// until createAppSession attaches the session (once, right after creating it), and then sends every
// request through the authorized client. With requiresAccount: true nothing registers before sign-in,
// so in practice nothing reaches it unattached.
import { err } from '@/core/result';

import type { ApiClient } from './api-client';
import type { SessionManager } from '@/services/session/session-types';

/** An ApiClient bound to the app's one session once that session exists. */
export type SessionApiClient = ApiClient & {
  /** Binds the session; createAppSession calls it once, right after createSessionManager. */
  readonly attach: (session: SessionManager) => void;
};

/** `create` builds the authorized client for the session (createAuthorizedApiClient). */
export function createSessionApiClient(
  create: (session: SessionManager) => ApiClient,
): SessionApiClient {
  let signedIn: ApiClient | null = null;
  return {
    request: (request) =>
      signedIn === null
        ? Promise.resolve(err({ kind: 'unauthorized' }))
        : signedIn.request(request),
    attach: (session) => {
      signedIn = create(session);
    },
  };
}
