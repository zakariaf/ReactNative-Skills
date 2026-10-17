// src/core/session/token-set.test.ts
import * as fc from 'fast-check';
import * as v from 'valibot';

import {
  isAccessTokenFresh,
  isAccessTokenUnexpired,
  isSessionEnding,
  MAX_TOKEN_LIFETIME_MS,
  REFRESH_SKEW_MS,
  SESSION_META_SCHEMA,
  tokenSetFromGrant,
} from './token-set';

import type { RefreshFailure, TokenSet } from './token-set';

const NOW = 1_700_000_000_000;
const PREVIOUS: TokenSet = {
  accessToken: 'old-access',
  refreshToken: 'old-refresh',
  expiresAtMs: NOW,
};

describe('tokenSetFromGrant', () => {
  it('turns expires_in seconds into an absolute expiry', () => {
    const tokens = tokenSetFromGrant(
      { accessToken: 'a', refreshToken: 'r', expiresInSeconds: 3600 },
      NOW,
      null,
    );

    expect(tokens).toStrictEqual({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAtMs: NOW + 3_600_000,
    });
  });

  it('keeps the previous refresh token when the server does not rotate it', () => {
    expect(tokenSetFromGrant({ accessToken: 'a' }, NOW, PREVIOUS).refreshToken).toBe('old-refresh');
    expect(
      tokenSetFromGrant({ accessToken: 'a', refreshToken: 'new' }, NOW, PREVIOUS).refreshToken,
    ).toBe('new');
    expect(tokenSetFromGrant({ accessToken: 'a' }, NOW, null).refreshToken).toBeNull();
  });

  it('trusts no lifetime that is missing, zero, negative, not finite or longer than a day', () => {
    const expiries = [undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY, 10 ** 9].map(
      (expiresInSeconds) => {
        const grant =
          expiresInSeconds === undefined
            ? { accessToken: 'a' }
            : { accessToken: 'a', expiresInSeconds };
        return tokenSetFromGrant(grant, NOW, null).expiresAtMs;
      },
    );

    expect(expiries).toStrictEqual([null, null, null, null, null, NOW + MAX_TOKEN_LIFETIME_MS]);
  });

  it('sets a whole-millisecond expiry, never in the past or beyond the cap', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true }), (expiresInSeconds) => {
        const { expiresAtMs } = tokenSetFromGrant(
          { accessToken: 'a', expiresInSeconds },
          NOW,
          null,
        );
        return (
          expiresAtMs === null ||
          (Number.isInteger(expiresAtMs) &&
            expiresAtMs >= NOW &&
            expiresAtMs <= NOW + MAX_TOKEN_LIFETIME_MS)
        );
      }),
    );
  });
});

describe('token freshness', () => {
  const expiring = (msLeft: number): TokenSet => ({ ...PREVIOUS, expiresAtMs: NOW + msLeft });

  it('asks for a refresh inside the skew, before the token lapses', () => {
    expect(isAccessTokenFresh(expiring(REFRESH_SKEW_MS + 1), NOW)).toBe(true);
    expect(isAccessTokenFresh(expiring(REFRESH_SKEW_MS), NOW)).toBe(false);
    expect(isAccessTokenFresh({ ...PREVIOUS, expiresAtMs: null }, NOW)).toBe(true);
  });

  it('lets an unexpired token go out while a refresh cannot happen', () => {
    expect(isAccessTokenUnexpired(expiring(1), NOW)).toBe(true);
    expect(isAccessTokenUnexpired(expiring(0), NOW)).toBe(false);
    expect(isAccessTokenUnexpired({ ...PREVIOUS, expiresAtMs: null }, NOW)).toBe(true);
  });
});

describe('isSessionEnding', () => {
  it('ends the session only for a refused grant or client', () => {
    const failures: RefreshFailure[] = [
      { kind: 'invalid-grant' },
      { kind: 'rejected', code: 'invalid_client' },
      { kind: 'network-unavailable' },
      { kind: 'timed-out', afterMs: 15_000 },
      { kind: 'server-unavailable' },
    ];

    expect(failures.map(isSessionEnding)).toStrictEqual([true, true, false, false, false]);
  });
});

describe('SESSION_META_SCHEMA', () => {
  it('accepts the stored shape and refuses anything else', () => {
    const meta = { version: 1, expiresAtMs: NOW, account: { id: 'acc-1', displayName: null } };

    expect(v.safeParse(SESSION_META_SCHEMA, meta).success).toBe(true);
    expect(v.safeParse(SESSION_META_SCHEMA, { ...meta, version: 2 }).success).toBe(false);
    expect(v.safeParse(SESSION_META_SCHEMA, { ...meta, account: { id: '' } }).success).toBe(false);
  });
});
