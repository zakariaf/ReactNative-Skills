// src/api/authorized-api-client.ts
// Shape (it builds on networking-and-server-state's ApiClient): the app's server, signed in. The
// fetch client reads the bearer token through sessionHeaders(); every request goes through
// sendWithSession(), which renews the token once after a 401 and signs out after a second one. A
// signed-out session answers 'unauthorized' without touching the network.
import { err } from '@/core/result';
import { sendWithSession, sessionHeaders } from '@/services/session/send-with-session';

import { createFetchApiClient } from './fetch-api-client';

import type { ApiClient } from './api-client';
import type { ApiFailure } from './api-failure';
import type { FetchApiClientOptions } from './fetch-api-client';
import type { SessionFailure, SessionManager } from '@/services/session/session-types';

/** The session's own failures, in the ApiClient's family (the UI already maps these kinds). */
function toApiFailure(failure: ApiFailure | SessionFailure): ApiFailure {
  if (failure.kind === 'signed-out') return { kind: 'unauthorized' };
  if (failure.kind === 'server-unavailable' && !('status' in failure)) {
    return { kind: 'server-unavailable', status: 503 };
  }
  return failure;
}

export type AuthorizedApiClientOptions = {
  /** Everything the fetch client needs except headers, which come from the session. */
  readonly transport: Omit<FetchApiClientOptions, 'headers'>;
  readonly session: SessionManager;
};

export function createAuthorizedApiClient({
  transport,
  session,
}: AuthorizedApiClientOptions): ApiClient {
  const inner = createFetchApiClient({ ...transport, headers: sessionHeaders(session) });
  return {
    request: async (request) => {
      const answer = await sendWithSession(session, () => inner.request(request));
      return answer.ok ? answer : err(toApiFailure(answer.error));
    },
  };
}
