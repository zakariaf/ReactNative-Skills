// src/services/session/session-manager-sign-out.test.ts
// Sign-out, against fakes: the server steps first with the still-valid token, the wipe, the publish,
// every local step in order, the revoke, and the races between sign-outs and sign-ins.
import { err } from '@/core/result';
import { createFakeClock } from '@/services/clock/fake-clock';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createFakeInstallMarker } from '@/services/install-marker/fake-install-marker';
import { createFakeOauth } from '@/services/oauth/fake-oauth';
import { createFakeSecureStorage } from '@/services/secure-storage/fake-secure-storage';
import { flushMicrotasks } from '@test/flush-microtasks';

import { createSessionManager } from './session-manager';

import type { ServerSignOutStep, SessionSnapshot, SignOutStep } from './session-types';
import type { FakeInstallMarkerOptions } from '@/services/install-marker/fake-install-marker';
import type { SecureKey } from '@/services/secure-storage/secure-key-names';

const NOW = 1_700_000_000_000;
const ACCOUNT = { id: 'acc-1', displayName: 'Robin' };
const META = JSON.stringify({ version: 1, expiresAtMs: NOW + 3_600_000, account: ACCOUNT });
const STORED: Partial<Record<SecureKey, string>> = {
  'auth.access-token': 'access-1',
  'auth.refresh-token': 'refresh-1',
  'auth.session-meta': META,
};

type Setup = {
  readonly stored?: Partial<Record<SecureKey, string>>;
  readonly marker?: FakeInstallMarkerOptions;
  readonly steps?: readonly SignOutStep[];
  readonly serverSteps?: readonly ServerSignOutStep[];
};

function setup({ stored = STORED, marker = {}, steps = [], serverSteps = [] }: Setup = {}) {
  const secureStorage = createFakeSecureStorage(stored);
  const installMarker = createFakeInstallMarker(marker);
  const oauth = createFakeOauth();
  const clock = createFakeClock({ nowMs: NOW, today: '2026-10-10' });
  const errorLog = createFakeErrorLog();
  const session = createSessionManager({
    secureStorage,
    installMarker,
    refresher: oauth,
    clock,
    errorLog,
    signOutSteps: steps,
    serverSignOutSteps: serverSteps,
  });
  const seen: SessionSnapshot[] = [];
  session.subscribe(() => seen.push(session.getSnapshot()));
  return { session, secureStorage, installMarker, oauth, clock, errorLog, seen };
}

describe('signOut', () => {
  it('wipes the tokens, publishes, runs every step in order, then revokes', async () => {
    const order: string[] = [];
    const steps = [
      {
        name: 'query-cache',
        run: () => {
          order.push('query-cache');
        },
      },
      {
        name: 'account-data',
        run: () => {
          order.push('account-data');
        },
      },
    ];
    const { session, secureStorage, oauth } = setup({ steps });
    await session.restore();
    session.subscribe(() =>
      order.push(`published with ${String(secureStorage.stored().size)} keys`),
    );

    await session.signOut('user');

    expect(order).toStrictEqual(['published with 0 keys', 'query-cache', 'account-data']);
    expect(oauth.calls).toStrictEqual([{ method: 'revoke', refreshToken: 'refresh-1' }]);
    expect(session.getSnapshot()).toStrictEqual({ status: 'signed-out', reason: 'user' });
  });

  it('records a refused revoke, not an offline one, and stays signed out either way', async () => {
    const { session, oauth, errorLog } = setup();
    await session.restore();
    oauth.answerRevoke(err({ kind: 'denied', code: 'unsupported_token_type' }));

    await session.signOut('user');

    expect(errorLog.entries().map((entry) => entry.message)).toStrictEqual([
      'token revoke failed: denied',
    ]);
    expect(session.getSnapshot().status).toBe('signed-out');
  });

  it('signs out once when asked twice at the same time', async () => {
    const runs: string[] = [];
    const { session } = setup({
      steps: [
        {
          name: 'query-cache',
          run: () => {
            runs.push('ran');
          },
        },
      ],
    });
    await session.restore();

    await Promise.all([session.signOut('unauthorized'), session.signOut('user')]);
    await session.signOut('user');

    expect(runs).toStrictEqual(['ran']);
  });

  it('signs out again after a sign-in while the last sign-out was still finishing', async () => {
    let releaseStep: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      releaseStep = resolve;
    });
    const { session, secureStorage } = setup({ steps: [{ name: 'query-cache', run: () => held }] });
    await session.restore();

    const first = session.signOut('user');
    await flushMicrotasks();
    await session.signIn({ grant: { accessToken: 'a-2', refreshToken: 'r-2' }, account: ACCOUNT });
    const second = session.signOut('user');
    releaseStep();
    await Promise.all([first, second]);

    expect(secureStorage.stored().size).toBe(0);
    expect(session.getSnapshot()).toStrictEqual({ status: 'signed-out', reason: 'user' });
  });

  it('runs the server steps first, with the still-valid token, before anything is wiped', async () => {
    const order: string[] = [];
    const { session, secureStorage } = setup({
      serverSteps: [
        {
          name: 'push-registration',
          run: ({ accessToken }) => {
            order.push(
              `push-registration with ${accessToken}, ${String(secureStorage.stored().size)} keys`,
            );
          },
        },
      ],
      steps: [
        {
          name: 'query-cache',
          run: () => {
            order.push('query-cache');
          },
        },
      ],
    });
    await session.restore();

    await session.signOut('user');

    expect(order).toStrictEqual(['push-registration with access-1, 3 keys', 'query-cache']);
  });

  it('skips the server steps when the server ended the session', async () => {
    const ran: string[] = [];
    const { session, oauth, clock } = setup({
      serverSteps: [
        {
          name: 'push-registration',
          run: () => {
            ran.push('push-registration');
          },
        },
      ],
    });
    await session.restore();
    clock.advance(3_600_000);
    oauth.answerRefresh(err({ kind: 'invalid-grant' }));

    await session.accessToken();

    expect([ran, session.getSnapshot().status]).toStrictEqual([[], 'signed-out']);
  });

  it('lets a sign-out during restore win: nothing restored stays in memory', async () => {
    const { session, secureStorage } = setup();

    const restored = session.restore({ isForeground: true });
    const signedOut = session.signOut('unauthorized');
    await Promise.all([restored, signedOut]);

    expect(session.getSnapshot().status).toBe('signed-out');
    expect(secureStorage.stored().size).toBe(0);
    expect(session.peekAccessToken()).toBeNull();
    await expect(session.accessToken()).resolves.toStrictEqual(err({ kind: 'signed-out' }));
  });

  it('clears the install marker when a key will not go away, so the next launch wipes it', async () => {
    const { session, secureStorage, installMarker } = setup();
    await session.restore();
    secureStorage.failNext('remove');

    await session.signOut('user');

    expect(installMarker.isSet()).toBe(false);
    expect(session.getSnapshot().status).toBe('signed-out');
  });
});
