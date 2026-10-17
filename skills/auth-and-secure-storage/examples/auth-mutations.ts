// src/api/auth/auth-mutations.ts
// Shape (it builds on networking-and-server-state's ApiClient and mutation conventions): the sign-in
// writes that go to the app's server. The server is the session's one token issuer: every sign-in
// method (the OAuth provider's id token, Apple's credential) is exchanged here for the server's own
// tokens, so the one refresher the session holds (server-refresher.ts) can renew every session. The
// exchanges are plain requests, not mutations: TanStack keeps a mutation's variables and data in its
// MutationCache until gcTime (devtools read it, and a persisted client dehydrates paused mutations),
// and both directions carry credentials here. Account deletion is a mutation without secrets,
// followed by a sign-out that clears the cache.
import { mutationOptions } from '@tanstack/react-query';
import * as v from 'valibot';

import { NO_CONTENT } from '@/api/api-client';
import { unwrap } from '@/api/api-error';

import type { ApiClient } from '@/api/api-client';
import type { ApiFailure } from '@/api/api-failure';
import type { ApiMutationOptions } from '@/api/api-query-options';
import type { Result } from '@/core/result';
import type { TokenGrant } from '@/core/session/token-set';
import type { AppleCredential } from '@/services/apple-sign-in/apple-sign-in-port';

/** The server's own tokens, as POST /auth/<method> and POST /auth/refresh answer them. */
export const serverTokensSchema = v.object({
  accessToken: v.pipe(v.string(), v.minLength(1)),
  refreshToken: v.optional(v.string()),
  expiresIn: v.optional(v.number()),
});

/** A sign-in exchange's answer: the server's tokens and who signed in (extra fields pass). */
export const serverSignInResponseSchema = v.object({
  ...serverTokensSchema.entries,
  account: v.object({
    id: v.pipe(v.string(), v.minLength(1)),
    displayName: v.nullable(v.string()),
  }),
});

export type ServerTokens = v.InferOutput<typeof serverTokensSchema>;
export type ServerSignInResponse = v.InferOutput<typeof serverSignInResponseSchema>;

/** The server's tokens as the session's grant (only the fields the server sent). */
export function grantFromServerTokens({
  accessToken,
  refreshToken,
  expiresIn,
}: ServerTokens): TokenGrant {
  return {
    accessToken,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(expiresIn === undefined ? {} : { expiresInSeconds: expiresIn }),
  };
}

/**
 * Sends the OAuth provider's id token to the app's server, which verifies it (signature, issuer,
 * audience, expiry) and answers with its own tokens. The provider's tokens are then dropped: they
 * never reach the secure store, and the session refreshes at the server only.
 */
export function exchangeOauthIdToken(
  api: ApiClient,
  idToken: string,
): Promise<Result<ServerSignInResponse, ApiFailure>> {
  return api.request({
    method: 'POST',
    path: '/auth/oauth',
    body: { idToken },
    schema: serverSignInResponseSchema,
  });
}

/**
 * Sends Apple's credential to the app's server and returns the app's own tokens. Use the plain
 * ApiClient: sign-in happens signed out, and the authorized one sends nothing without a session.
 */
export function exchangeAppleCredential(
  api: ApiClient,
  credential: AppleCredential,
): Promise<Result<ServerSignInResponse, ApiFailure>> {
  return api.request({
    method: 'POST',
    path: '/auth/apple',
    body: credential,
    schema: serverSignInResponseSchema,
  });
}

export const authMutations = {
  deleteAccount: (api: ApiClient): ApiMutationOptions<null, undefined> =>
    mutationOptions<null, Error, undefined>({
      mutationFn: () =>
        unwrap(api.request({ method: 'DELETE', path: '/account', schema: NO_CONTENT })),
      // no-cache-effect: the sign-out that follows clears the whole query cache (queryCacheStep)
    }),
};
