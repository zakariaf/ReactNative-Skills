// src/services/session/send-with-session.ts
// Sends one authorized request for the session. It asks for a token first (refreshed ahead of its
// expiry, so most requests never see a 401), then sends; on a 401 the session renews the rejected
// token once, sharing any refresh another request already started, and the request goes out once
// more; a second 401 means the server no longer accepts this session, so it signs out. The request
// reads the token through sessionHeaders(), the ApiClient's headers hook, so this file never touches
// the network itself.
import type { SessionFailure, SessionManager } from './session-types';
import type { Result } from '@/core/result';

/** The failure kind the ApiClient uses for a 401 (networking-and-server-state's ApiFailure). */
export const UNAUTHORIZED_KIND = 'unauthorized';

/** Any failure family discriminated by `kind`. */
export type KindedFailure = { readonly kind: string };

type SessionForRequests = Pick<
  SessionManager,
  'accessToken' | 'renewAfterUnauthorized' | 'signOut'
>;

function isUnauthorized<TValue>(answer: Result<TValue, KindedFailure>): boolean {
  return !answer.ok && answer.error.kind === UNAUTHORIZED_KIND;
}

/** Sends with a fresh token, renews once after a 401, and signs out after a second 401. */
export async function sendWithSession<TValue, TFailure extends KindedFailure>(
  session: SessionForRequests,
  send: () => Promise<Result<TValue, TFailure>>,
): Promise<Result<TValue, TFailure | SessionFailure>> {
  const token = await session.accessToken();
  if (!token.ok) return token;
  const first = await send();
  if (!isUnauthorized(first)) return first;
  const renewed = await session.renewAfterUnauthorized(token.value);
  if (!renewed.ok) return renewed;
  const second = await send();
  if (isUnauthorized(second)) await session.signOut('unauthorized');
  return second;
}

/** The ApiClient's `headers` option: the access token as a bearer token, or nothing when signed out. */
export function sessionHeaders(
  session: Pick<SessionManager, 'accessToken'>,
): () => Promise<Readonly<Record<string, string>>> {
  return async () => {
    const token = await session.accessToken();
    return token.ok ? { Authorization: `Bearer ${token.value}` } : {};
  };
}
