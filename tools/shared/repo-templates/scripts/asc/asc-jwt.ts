// scripts/asc/asc-jwt.ts
// The ES256 token for the App Store Connect API. Pure: the key arrives in memory and the time as a
// value (scripts/clock/system-clock.ts is the only wall-clock reader). The token is a secret too.
import { createPrivateKey, sign } from 'node:crypto';

export type AscCredentials = {
  readonly keyId: string;
  readonly issuerId: string;
  readonly privateKeyPem: string;
};

/** Apple rejects tokens whose exp is more than 20 minutes after iat; 15 leaves room for skew. */
export const ASC_TOKEN_LIFETIME_SECONDS = 15 * 60;
const AUDIENCE = 'appstoreconnect-v1';

function toBase64Url(value: string | Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

export function createAscJwt(credentials: AscCredentials, nowEpochSeconds: number): string {
  const header = { alg: 'ES256', kid: credentials.keyId, typ: 'JWT' };
  const payload = {
    iss: credentials.issuerId,
    iat: nowEpochSeconds,
    exp: nowEpochSeconds + ASC_TOKEN_LIFETIME_SECONDS,
    aud: AUDIENCE,
  };
  const signingInput = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(payload))}`;
  // JWTs need the raw r||s signature (IEEE P1363), not Node's default DER encoding.
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: createPrivateKey(credentials.privateKeyPem),
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${toBase64Url(signature)}`;
}
