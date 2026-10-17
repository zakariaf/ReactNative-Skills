// src/core/session/token-set.ts
// The tokens of one signed-in session as plain data, and the pure rules about them: when an access
// token needs a refresh, what a token endpoint's answer turns into, and which refresh failures end
// the session. Pure TypeScript: time arrives as a value, nothing here reads a clock or a store.
import * as v from 'valibot';

/** What the app holds while someone is signed in (only in memory and in the secure store). */
export type TokenSet = {
  readonly accessToken: string;
  /** null when the server issues no refresh token: the session ends when the access token does. */
  readonly refreshToken: string | null;
  /** Whole epoch ms when the access token stops working; null when the server gave no lifetime. */
  readonly expiresAtMs: number | null;
};

/** The non-secret facts about who is signed in (never a token). */
export type Account = {
  readonly id: string;
  readonly displayName: string | null;
};

/** A token endpoint's answer (OAuth 2.0 token response, RFC 6749 section 5.1), camel-cased. */
export type TokenGrant = {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresInSeconds?: number;
  readonly idToken?: string;
};

/** Why a refresh produced no tokens. */
export type RefreshFailure =
  /** The refresh token expired, was revoked or was used twice: the session is over. */
  | { readonly kind: 'invalid-grant' }
  /** The server refused the client itself (invalid_client, ...): over, and a defect worth recording. */
  | { readonly kind: 'rejected'; readonly code: string }
  | { readonly kind: 'network-unavailable' }
  | { readonly kind: 'timed-out'; readonly afterMs: number }
  | { readonly kind: 'server-unavailable' };

/** Refresh this long before the expiry, so a request never leaves with a token about to lapse. */
export const REFRESH_SKEW_MS = 60_000;

/** The longest lifetime trusted from a server, so a bad expires_in cannot keep a token forever. */
export const MAX_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * Turns a grant into the tokens to keep. A refresh answer without a refresh token keeps the previous
 * one (RFC 6749 section 6: the server may or may not rotate it); a new one always replaces it.
 */
export function tokenSetFromGrant(
  grant: TokenGrant,
  nowMs: number,
  previous: TokenSet | null,
): TokenSet {
  const lifetime = grant.expiresInSeconds;
  const hasLifetime = lifetime !== undefined && Number.isFinite(lifetime) && lifetime > 0;
  return {
    accessToken: grant.accessToken,
    refreshToken: grant.refreshToken ?? previous?.refreshToken ?? null,
    expiresAtMs: hasLifetime
      ? nowMs + Math.floor(Math.min(lifetime * 1000, MAX_TOKEN_LIFETIME_MS))
      : null,
  };
}

/** True while the access token can still be sent: not within the skew of its expiry. */
export function isAccessTokenFresh(tokens: TokenSet, nowMs: number): boolean {
  return tokens.expiresAtMs === null || tokens.expiresAtMs - nowMs > REFRESH_SKEW_MS;
}

/** True until the access token's expiry itself (used when a refresh failed for a passing reason). */
export function isAccessTokenUnexpired(tokens: TokenSet, nowMs: number): boolean {
  return tokens.expiresAtMs === null || tokens.expiresAtMs > nowMs;
}

/** The refresh failures after which no refresh can ever succeed. */
export type SessionEndingFailure = Extract<
  RefreshFailure,
  { readonly kind: 'invalid-grant' | 'rejected' }
>;

/** Only these end a session; every other failure passes, and the session is kept. */
export function isSessionEnding(failure: RefreshFailure): failure is SessionEndingFailure {
  return failure.kind === 'invalid-grant' || failure.kind === 'rejected';
}

/** The JSON kept under the session-meta key: never a token. */
export const SESSION_META_SCHEMA = v.object({
  version: v.literal(1),
  expiresAtMs: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
  account: v.object({
    id: v.pipe(v.string(), v.minLength(1)),
    displayName: v.nullable(v.string()),
  }),
});

export type SessionMeta = v.InferOutput<typeof SESSION_META_SCHEMA>;
