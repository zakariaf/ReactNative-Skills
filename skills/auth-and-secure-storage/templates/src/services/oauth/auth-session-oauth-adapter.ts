// src/services/oauth/auth-session-oauth-adapter.ts
// The OauthPort on expo-auth-session, and the only app file that imports it. Authorization code
// with PKCE (a SHA-256 code challenge) in the system browser, never the implicit flow, never a
// client secret (an app cannot keep one). The browser session is ephemeral on iOS: no "wants to use
// ... to sign in" prompt and no cookies shared with Safari, so after sign-out the provider asks
// again instead of signing the last person straight back in. expo-auth-session's token calls take
// no signal, so each is raced against a deadline (withTimeout) and an abandoned answer is ignored.
// A refresh abandoned that way may still have rotated the refresh token at the server; the next
// refresh then answers invalid_grant and signs out cleanly, unless the server accepts the previous
// refresh token for a short grace period (ask for one).
import {
  AuthRequest,
  CodeChallengeMethod,
  exchangeCodeAsync,
  fetchDiscoveryAsync,
  makeRedirectUri,
  refreshAsync,
  ResponseType,
  revokeAsync,
  TokenTypeHint,
} from 'expo-auth-session';

import { attemptAsync, err, ok } from '@/core/result';
import { withTimeout } from '@/services/async/with-timeout';

import type { OauthConfig, OauthFailure, OauthPort } from './oauth-port';
import type { Result } from '@/core/result';
import type { RefreshFailure, TokenGrant } from '@/core/session/token-set';
import type { TimedOut } from '@/services/async/with-timeout';
import type { DiscoveryDocument, TokenResponse } from 'expo-auth-session';

/** The redirect path; Android also delivers it to Expo Router, so src/app/oauth-redirect.tsx exists. */
export const OAUTH_REDIRECT_PATH = 'oauth-redirect';
export const OAUTH_TIMEOUT_MS = 15_000;
/** OAuth error codes (RFC 6749 section 5.2 and 4.1.2.1) that mean "try again later". */
const BUSY_CODES = new Set(['temporarily_unavailable', 'server_error']);

type Transient = Extract<
  OauthFailure,
  { readonly kind: 'network-unavailable' | 'server-unavailable' }
>;

/** The OAuth `error` code of a thrown TokenError/AuthError (expo-auth-session sets `code`). */
function codeOf(thrown: unknown): string | null {
  const code = (thrown as { readonly code?: unknown } | null)?.code;
  return typeof code === 'string' && code !== '' ? code : null;
}

/** No OAuth code: no answer at all (offline, TLS) or a body that was not JSON; both pass. */
function transientOf(code: string | null): Transient {
  return code !== null && BUSY_CODES.has(code)
    ? { kind: 'server-unavailable' }
    : { kind: 'network-unavailable' };
}

export function refreshFailureOf(thrown: unknown): RefreshFailure {
  const code = codeOf(thrown);
  if (code === 'invalid_grant') return { kind: 'invalid-grant' };
  if (code === null || BUSY_CODES.has(code)) return transientOf(code);
  return { kind: 'rejected', code };
}

function grantOf(response: TokenResponse): TokenGrant {
  return {
    accessToken: response.accessToken,
    ...(response.refreshToken === undefined ? {} : { refreshToken: response.refreshToken }),
    ...(response.expiresIn === undefined ? {} : { expiresInSeconds: response.expiresIn }),
    ...(response.idToken === undefined ? {} : { idToken: response.idToken }),
  };
}

/** A refused code exchange is the provider's answer; no answer at all passes. */
function exchangeFailureOf(thrown: unknown): OauthFailure {
  const code = codeOf(thrown);
  return code === null || BUSY_CODES.has(code) ? transientOf(code) : { kind: 'denied', code };
}

/**
 * One vendor call under the deadline; a throw becomes `toFailure(thrown)`. No outer signal is
 * passed, so the deadline is the only way withTimeout stops early.
 */
async function call<TValue, TError>(
  task: () => Promise<TValue>,
  toFailure: (thrown: unknown) => TError,
): Promise<Result<TValue, TError | TimedOut>> {
  const raced = await withTimeout(
    async () => ok(await attemptAsync(task, toFailure)),
    OAUTH_TIMEOUT_MS,
  );
  return raced.ok ? raced.value : err({ kind: 'timed-out', afterMs: OAUTH_TIMEOUT_MS });
}

async function authorize(
  config: OauthConfig,
  discovery: DiscoveryDocument,
): Promise<Result<TokenGrant, OauthFailure>> {
  try {
    // <scheme>://oauth-redirect: the exact URI registered with the provider for this variant. Built
    // here, not when the adapter is created, so creating the app's services reads nothing native.
    const redirectUri = makeRedirectUri({ scheme: config.scheme, path: OAUTH_REDIRECT_PATH });
    const request = new AuthRequest({
      clientId: config.clientId,
      redirectUri,
      scopes: [...config.scopes],
      responseType: ResponseType.Code,
      usePKCE: true,
      codeChallengeMethod: CodeChallengeMethod.S256,
    });
    const answer = await request.promptAsync(discovery, { preferEphemeralSession: true });
    if (answer.type === 'error') {
      return err({ kind: 'denied', code: answer.params['error'] ?? 'unknown' });
    }
    if (answer.type !== 'success') return err({ kind: 'cancelled' });
    const exchanged = await call(
      () =>
        exchangeCodeAsync(
          {
            clientId: config.clientId,
            redirectUri,
            code: answer.params['code'] ?? '',
            // expo-auth-session does not add the PKCE verifier to the code exchange by itself.
            extraParams: { code_verifier: request.codeVerifier ?? '' },
          },
          discovery,
        ),
      exchangeFailureOf,
    );
    return exchanged.ok ? ok(grantOf(exchanged.value)) : exchanged;
  } catch (thrown) {
    // promptAsync rejects when another auth session is already open (iOS and Android alike).
    return err(exchangeFailureOf(thrown));
  }
}

type Discover = () => Promise<Result<DiscoveryDocument, OauthFailure>>;

/** Fetches the discovery document once per app run; a failed fetch is forgotten, so the next call tries again. */
function createDiscovery(issuer: string): Discover {
  let discovery: Promise<Result<DiscoveryDocument, OauthFailure>> | null = null;
  return () => {
    discovery ??= call(
      () => fetchDiscoveryAsync(issuer),
      () => transientOf(null),
    ).then((result) => {
      if (!result.ok) discovery = null;
      return result;
    });
    return discovery;
  };
}

async function refreshWith(
  config: OauthConfig,
  discover: Discover,
  refreshToken: string,
): Promise<Result<TokenGrant, RefreshFailure>> {
  try {
    const found = await discover();
    if (!found.ok) return err(transientOf(null));
    const refreshed = await call(
      () => refreshAsync({ clientId: config.clientId, refreshToken }, found.value),
      refreshFailureOf,
    );
    return refreshed.ok ? ok(grantOf(refreshed.value)) : refreshed;
  } catch (thrown) {
    return err(refreshFailureOf(thrown));
  }
}

async function revokeWith(
  config: OauthConfig,
  discover: Discover,
  refreshToken: string,
): Promise<Result<void, OauthFailure>> {
  try {
    const found = await discover();
    if (!found.ok) return found;
    const revoked = await call(
      () =>
        revokeAsync(
          {
            clientId: config.clientId,
            token: refreshToken,
            tokenTypeHint: TokenTypeHint.RefreshToken,
          },
          found.value,
        ),
      () => transientOf(null),
    );
    return revoked.ok ? ok(undefined) : revoked;
  } catch {
    return err(transientOf(null));
  }
}

export function createAuthSessionOauthAdapter(config: OauthConfig): OauthPort {
  const discover = createDiscovery(config.issuer);
  return {
    signIn: async () => {
      try {
        const found = await discover();
        return found.ok ? await authorize(config, found.value) : found;
      } catch (thrown) {
        return err(exchangeFailureOf(thrown));
      }
    },
    refresh: (refreshToken) => refreshWith(config, discover, refreshToken),
    revoke: (refreshToken) => revokeWith(config, discover, refreshToken),
  };
}
