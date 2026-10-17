// src/core/session/id-token-claims.test.ts
import fc from 'fast-check';

import { accountFromClaims, decodeBase64Url, readIdTokenClaims } from './id-token-claims';

/** Bytes to base64url through the platform's btoa (the reference the decoder must agree with). */
function encodeBase64Url(bytes: readonly number[]): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

/** UTF-8 bytes of a string, from encodeURIComponent's percent escapes. */
function utf8Bytes(text: string): number[] {
  return [...encodeURIComponent(text).matchAll(/%([0-9A-F]{2})|./gu)].map((match) =>
    match[1] === undefined ? match[0].charCodeAt(0) : Number.parseInt(match[1], 16),
  );
}

/** A JWT-shaped string with `payload` as its middle segment (header and signature are not read). */
function jwtWith(payload: string): string {
  return `eyJhbGciOiJSUzI1NiJ9.${encodeBase64Url(utf8Bytes(payload))}.signature`;
}

describe('decodeBase64Url', () => {
  it('decodes what btoa encodes, for any bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        const encoded = encodeBase64Url([...bytes]);
        return JSON.stringify(decodeBase64Url(encoded)) === JSON.stringify([...bytes]);
      }),
    );
  });

  it('refuses characters outside the base64url alphabet', () => {
    expect([decodeBase64Url('ab+c'), decodeBase64Url('ab/c')]).toStrictEqual([null, null]);
  });
});

describe('readIdTokenClaims', () => {
  it('reads the subject, name and email, in any script', () => {
    const token = jwtWith(JSON.stringify({ sub: 'user-1', name: 'روبن', email: 'r@example.com' }));

    expect(readIdTokenClaims(token)).toStrictEqual({
      ok: true,
      value: { sub: 'user-1', name: 'روبن', email: 'r@example.com' },
    });
  });

  it('tells a missing token from a malformed one', () => {
    expect(
      [undefined, '', 'one.two', jwtWith('not json'), jwtWith('{"name":"no subject"}')].map(
        readIdTokenClaims,
      ),
    ).toStrictEqual([
      { ok: false, error: { kind: 'id-token-missing' } },
      { ok: false, error: { kind: 'id-token-missing' } },
      { ok: false, error: { kind: 'id-token-malformed' } },
      { ok: false, error: { kind: 'id-token-malformed' } },
      { ok: false, error: { kind: 'id-token-malformed' } },
    ]);
  });
});

describe('accountFromClaims', () => {
  it('prefers the name, then the email, for the display name', () => {
    expect([
      accountFromClaims({ sub: 'a', name: 'Robin', email: 'r@example.com' }),
      accountFromClaims({ sub: 'b', email: 'r@example.com' }),
      accountFromClaims({ sub: 'c' }),
    ]).toStrictEqual([
      { id: 'a', displayName: 'Robin' },
      { id: 'b', displayName: 'r@example.com' },
      { id: 'c', displayName: null },
    ]);
  });
});
