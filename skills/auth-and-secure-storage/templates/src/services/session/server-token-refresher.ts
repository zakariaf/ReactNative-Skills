// src/services/session/server-token-refresher.ts
// The session's TokenRefresher when the app's own server issues the tokens: the default whenever the
// app has a server (Sign in with Apple needs one). A session holds exactly one refresher, so every
// sign-in method must end in tokens from that same issuer: OAuth sends the provider's id token to
// the server and Apple sends its credential there, and each answers with the server's own tokens.
// This file maps the server's answers to the refresh outcomes the session understands; only a dead
// refresh token ends the session. The calls themselves are the app's ApiClient (an endpoint object).
import { err, ok } from '@/core/result';

import type { TokenRefresher } from './session-types';
import type { Result } from '@/core/result';
import type { RefreshFailure, TokenGrant } from '@/core/session/token-set';

/** A failed call to the app's server, as its ApiClient reports it (ApiFailure fits this shape). */
export type ServerCallFailure =
  | {
      readonly kind:
        | 'network-unavailable'
        | 'cancelled'
        | 'unauthorized'
        | 'forbidden'
        | 'not-found'
        | 'conflict'
        | 'rate-limited'
        | 'server-unavailable'
        | 'invalid-response';
    }
  | { readonly kind: 'timed-out'; readonly afterMs: number }
  | { readonly kind: 'rejected'; readonly status: number; readonly code: string | null };

/** The token calls on the app's server. Like the ApiClient behind them, they never reject. */
export type ServerTokenEndpoint = {
  /** POST /auth/refresh with the refresh token; the server's grant (it may rotate the refresh token). */
  readonly refresh: (refreshToken: string) => Promise<Result<TokenGrant, ServerCallFailure>>;
  /** POST /auth/revoke, best effort at sign-out; leave it out when the server has no such call. */
  readonly revoke?: (refreshToken: string) => Promise<Result<unknown, ServerCallFailure>>;
};

/** The OAuth error code a server sends for an expired, revoked or reused refresh token. */
const DEAD_REFRESH_TOKEN_CODE = 'invalid_grant';

/**
 * What a failed refresh means for the session. A 401, or a 4xx with code `invalid_grant`, says the
 * refresh token is dead (the session ends). Any other refusal is a client defect (ends, recorded).
 * No connection, a timeout, 429, 5xx, a missing endpoint or a malformed body keep the session.
 */
export function refreshFailureOf(failure: ServerCallFailure): RefreshFailure {
  switch (failure.kind) {
    case 'unauthorized':
      return { kind: 'invalid-grant' };
    case 'rejected':
      return failure.code === DEAD_REFRESH_TOKEN_CODE
        ? { kind: 'invalid-grant' }
        : { kind: 'rejected', code: failure.code ?? `http-${String(failure.status)}` };
    case 'forbidden':
      return { kind: 'rejected', code: 'forbidden' };
    case 'timed-out':
      return { kind: 'timed-out', afterMs: failure.afterMs };
    case 'network-unavailable':
    case 'cancelled':
      return { kind: 'network-unavailable' };
    case 'rate-limited':
    case 'server-unavailable':
    case 'not-found':
    case 'conflict':
    case 'invalid-response':
      return { kind: 'server-unavailable' };
  }
}

export function createServerTokenRefresher(endpoint: ServerTokenEndpoint): TokenRefresher {
  const { revoke } = endpoint;
  const refresher: TokenRefresher = {
    refresh: async (refreshToken) => {
      const answer = await endpoint.refresh(refreshToken);
      return answer.ok ? ok(answer.value) : err(refreshFailureOf(answer.error));
    },
  };
  if (revoke === undefined) return refresher;
  return {
    ...refresher,
    revoke: async (refreshToken) => {
      const answer = await revoke(refreshToken);
      return answer.ok ? ok(undefined) : err({ kind: answer.error.kind });
    },
  };
}
