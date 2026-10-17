// src/services/session/server-token-refresher.test.ts
// The server refresher alone (which answers end a session), and inside a real session: a session
// that began with Sign in with Apple's server exchange refreshes at the same server.
import { err, ok } from '@/core/result';
import { createFakeClock } from '@/services/clock/fake-clock';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createFakeInstallMarker } from '@/services/install-marker/fake-install-marker';
import { createFakeSecureStorage } from '@/services/secure-storage/fake-secure-storage';

import { createServerTokenRefresher, refreshFailureOf } from './server-token-refresher';
import { createSessionManager } from './session-manager';

import type { ServerCallFailure, ServerTokenEndpoint } from './server-token-refresher';
import type { Result } from '@/core/result';
import type { TokenGrant } from '@/core/session/token-set';

const NOW = 1_700_000_000_000;

describe('refreshFailureOf', () => {
  it.each<[ServerCallFailure, string]>([
    [{ kind: 'unauthorized' }, 'invalid-grant'],
    [{ kind: 'rejected', status: 400, code: 'invalid_grant' }, 'invalid-grant'],
    [{ kind: 'rejected', status: 400, code: 'invalid_client' }, 'rejected'],
    [{ kind: 'forbidden' }, 'rejected'],
    [{ kind: 'network-unavailable' }, 'network-unavailable'],
    [{ kind: 'cancelled' }, 'network-unavailable'],
    [{ kind: 'timed-out', afterMs: 15_000 }, 'timed-out'],
    [{ kind: 'server-unavailable' }, 'server-unavailable'],
    [{ kind: 'rate-limited' }, 'server-unavailable'],
    [{ kind: 'not-found' }, 'server-unavailable'],
    [{ kind: 'invalid-response' }, 'server-unavailable'],
  ])('maps %o to %s', (failure, kind) => {
    expect(refreshFailureOf(failure).kind).toBe(kind);
  });

  it('names the status when a refusal has no code', () => {
    expect(refreshFailureOf({ kind: 'rejected', status: 422, code: null })).toStrictEqual({
      kind: 'rejected',
      code: 'http-422',
    });
  });
});

type Recorded = { readonly method: 'refresh' | 'revoke'; readonly refreshToken: string };

function endpointAnswering(
  refresh: Result<TokenGrant, ServerCallFailure>,
  calls: Recorded[],
): ServerTokenEndpoint {
  return {
    refresh: (refreshToken) => {
      calls.push({ method: 'refresh', refreshToken });
      return Promise.resolve(refresh);
    },
    revoke: (refreshToken) => {
      calls.push({ method: 'revoke', refreshToken });
      return Promise.resolve(err({ kind: 'server-unavailable' }));
    },
  };
}

function sessionWith(endpoint: ServerTokenEndpoint) {
  const clock = createFakeClock({ nowMs: NOW, today: '2026-10-10' });
  const session = createSessionManager({
    secureStorage: createFakeSecureStorage(),
    installMarker: createFakeInstallMarker(),
    refresher: createServerTokenRefresher(endpoint),
    clock,
    errorLog: createFakeErrorLog(),
    signOutSteps: [],
  });
  return { session, clock };
}

/** What POST /auth/apple answered after the server verified Apple's identity token. */
const APPLE_EXCHANGE: TokenGrant = {
  accessToken: 'server-access-1',
  refreshToken: 'server-refresh-1',
  expiresInSeconds: 3600,
};
const ACCOUNT = { id: 'acc-apple', displayName: null };

describe('createServerTokenRefresher in a session', () => {
  it('refreshes an Apple-signed session at the server that issued its tokens', async () => {
    const calls: Recorded[] = [];
    const rotated = ok({ accessToken: 'server-access-2', refreshToken: 'server-refresh-2' });
    const { session, clock } = sessionWith(endpointAnswering(rotated, calls));
    await session.restore();
    await session.signIn({ grant: APPLE_EXCHANGE, account: ACCOUNT });
    clock.advance(3_600_000);

    const token = await session.accessToken();

    expect(token).toStrictEqual(ok('server-access-2'));
    expect(calls).toStrictEqual([{ method: 'refresh', refreshToken: 'server-refresh-1' }]);
  });

  it('signs out when the server says the refresh token is dead', async () => {
    const calls: Recorded[] = [];
    const { session, clock } = sessionWith(endpointAnswering(err({ kind: 'unauthorized' }), calls));
    await session.restore();
    await session.signIn({ grant: APPLE_EXCHANGE, account: ACCOUNT });
    clock.advance(3_600_000);

    await session.accessToken();

    expect(session.getSnapshot().status).toBe('signed-out');
    expect(calls.map((call) => call.method)).toStrictEqual(['refresh', 'revoke']);
  });

  it('keeps the session when the server cannot answer', async () => {
    const calls: Recorded[] = [];
    const { session, clock } = sessionWith(
      endpointAnswering(err({ kind: 'server-unavailable' }), calls),
    );
    await session.restore();
    await session.signIn({ grant: APPLE_EXCHANGE, account: ACCOUNT });
    clock.advance(3_600_000);

    await session.accessToken();

    expect(session.getSnapshot()).toStrictEqual({ status: 'signed-in', account: ACCOUNT });
  });

  it('has no revoke when the server offers none', () => {
    const refresher = createServerTokenRefresher({
      refresh: () => Promise.resolve(err({ kind: 'network-unavailable' })),
    });

    expect(refresher.revoke).toBeUndefined();
  });
});
