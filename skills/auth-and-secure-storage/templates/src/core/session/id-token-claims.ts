// src/core/session/id-token-claims.ts
// Reads the display facts (subject, name, email) from an OpenID Connect id token, a JWT, without
// verifying it: good enough to greet the person right after sign-in, never for a decision. The app's
// server verifies the signature, issuer, audience, nonce and expiry before it trusts any token, and
// what it returns wins. Pure TypeScript: base64url and UTF-8 are decoded here, with no runtime global.
import * as v from 'valibot';

import { attempt, err, ok } from '@/core/result';

import type { Account } from './token-set';
import type { Result } from '@/core/result';

export type IdTokenFailure =
  { readonly kind: 'id-token-missing' } | { readonly kind: 'id-token-malformed' };

const CLAIMS_SCHEMA = v.object({
  sub: v.pipe(v.string(), v.minLength(1)),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
});

export type IdTokenClaims = v.InferOutput<typeof CLAIMS_SCHEMA>;

const MALFORMED: IdTokenFailure = { kind: 'id-token-malformed' };

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url (RFC 4648 section 5, padding optional) to bytes; null on a character outside it. */
export function decodeBase64Url(text: string): readonly number[] | null {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text.replace(/=+$/u, '')) {
    const sextet = ALPHABET.indexOf(char);
    if (sextet === -1) return null;
    buffer = buffer * 64 + sextet;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      const divisor = 2 ** bits;
      bytes.push(Math.floor(buffer / divisor));
      buffer %= divisor;
    }
  }
  return bytes;
}

/** UTF-8 bytes to text; null when they are not valid UTF-8 (decodeURIComponent throws URIError). */
function utf8Of(bytes: readonly number[]): string | null {
  const escaped = bytes.map((byte) => `%${byte.toString(16).padStart(2, '0')}`).join('');
  const decoded = attempt(
    () => decodeURIComponent(escaped),
    () => MALFORMED,
  );
  return decoded.ok ? decoded.value : null;
}

/** The unverified claims of a JWT's payload segment. */
export function readIdTokenClaims(
  idToken: string | undefined,
): Result<IdTokenClaims, IdTokenFailure> {
  if (idToken === undefined || idToken === '') return err({ kind: 'id-token-missing' });
  const segments = idToken.split('.');
  const payload = segments.length === 3 ? decodeBase64Url(segments[1] ?? '') : null;
  const text = payload === null ? null : utf8Of(payload);
  if (text === null) return err(MALFORMED);
  const json = attempt(
    (): unknown => JSON.parse(text),
    () => MALFORMED,
  );
  if (!json.ok) return json;
  const parsed = v.safeParse(CLAIMS_SCHEMA, json.value);
  return parsed.success ? ok(parsed.output) : err(MALFORMED);
}

/** The account facts the session keeps (non-secret), from the claims. */
export function accountFromClaims(claims: IdTokenClaims): Account {
  return { id: claims.sub, displayName: claims.name ?? claims.email ?? null };
}
