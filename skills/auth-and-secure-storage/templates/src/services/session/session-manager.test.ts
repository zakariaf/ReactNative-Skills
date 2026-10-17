// src/services/session/session-manager.test.ts
// The session rules, each against fakes: restore and the fresh-install wipe, persist before publish,
// one refresh at a time, which failures end a session, and the refresh race (sign-out itself is in
// session-manager-sign-out.test.ts).
import { err, ok } from '@/core/result';
import { createFakeClock } from '@/services/clock/fake-clock';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createFakeInstallMarker } from '@/services/install-marker/fake-install-marker';
import { createFakeOauth } from '@/services/oauth/fake-oauth';
import { createFakeSecureStorage } from '@/services/secure-storage/fake-secure-storage';
import { SECURE_KEYS } from '@/services/secure-storage/secure-key-names';
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

describe('restore', () => {
  it('starts restoring, then publishes the stored session', async () => {
    const { session, seen } = setup();

    const before = session.getSnapshot();
    await session.restore();

    expect(before).toStrictEqual({ status: 'restoring' });
    expect(seen).toStrictEqual([{ status: 'signed-in', account: ACCOUNT }]);
    await expect(session.accessToken()).resolves.toStrictEqual({ ok: true, value: 'access-1' });
  });

  it('wipes what a previous install left in the keychain on a fresh install', async () => {
    const { session, secureStorage, installMarker } = setup({ marker: { isPresent: false } });

    const snapshot = await session.restore();

    expect(snapshot).toStrictEqual({ status: 'signed-out', reason: 'fresh-install' });
    expect([secureStorage.stored().size, installMarker.isSet()]).toStrictEqual([0, true]);
  });

  it('keeps the marker unset when the fresh-install wipe fails, so the next launch wipes again', async () => {
    const { session, secureStorage, installMarker } = setup({ marker: { isPresent: false } });
    secureStorage.failNext('remove');

    await session.restore();

    expect(installMarker.isSet()).toBe(false);
  });

  it('keeps the session when the marker cannot be read', async () => {
    const { session } = setup({ marker: { isFailing: true } });

    await expect(session.restore()).resolves.toStrictEqual({
      status: 'signed-in',
      account: ACCOUNT,
    });
  });

  it('reports a locked keychain as unavailable, not signed out, and restores again later', async () => {
    const { session, secureStorage } = setup();
    secureStorage.failNext('read');

    const locked = await session.restore();
    secureStorage.failNext(null);
    const later = await session.restore();

    expect([locked, later]).toStrictEqual([
      { status: 'unavailable' },
      { status: 'signed-in', account: ACCOUNT },
    ]);
    expect(secureStorage.stored().size).toBe(3);
  });

  it('reads once more in the foreground, where a lock cannot explain a failed read', async () => {
    const store = createFakeSecureStorage(STORED);
    let reads = 0;
    const flaky = {
      ...store,
      read: (key: SecureKey) => {
        reads += 1;
        return reads === 1
          ? Promise.resolve(err({ kind: 'secure-storage-unavailable', operation: 'read' } as const))
          : store.read(key);
      },
    };
    const session = createSessionManager({
      secureStorage: flaky,
      installMarker: createFakeInstallMarker(),
      refresher: createFakeOauth(),
      clock: createFakeClock({ nowMs: NOW, today: '2026-10-10' }),
      errorLog: createFakeErrorLog(),
      signOutSteps: [],
    });

    await expect(session.restore({ isForeground: true })).resolves.toStrictEqual({
      status: 'signed-in',
      account: ACCOUNT,
    });
  });

  it('signs out, keeping the values, when the store fails twice in the foreground', async () => {
    const { session, secureStorage, errorLog } = setup();
    secureStorage.failNext('read');

    const snapshot = await session.restore({ isForeground: true });
    const again = await session.restore({ isForeground: true });

    expect([snapshot, again]).toStrictEqual([
      { status: 'signed-out', reason: 'storage-unavailable' },
      { status: 'signed-out', reason: 'storage-unavailable' },
    ]);
    expect(secureStorage.calls.filter((call) => call.operation === 'read')).toHaveLength(2);
    expect([secureStorage.stored().size, errorLog.recorded.length]).toStrictEqual([3, 1]);
  });

  it('lets the person sign in again after the store could not be read', async () => {
    const { session, secureStorage } = setup();
    secureStorage.failNext('read');
    await session.restore({ isForeground: true });
    secureStorage.failNext(null);

    const signedIn = await session.signIn({
      grant: { accessToken: 'a', refreshToken: 'r' },
      account: ACCOUNT,
    });

    expect(signedIn).toStrictEqual({ ok: true, value: undefined });
    expect(secureStorage.stored().get(SECURE_KEYS.refreshToken)).toBe('r');
  });

  it('signs out on an unreadable session and keeps it for a build that can read it', async () => {
    const { session, secureStorage, errorLog } = setup({
      stored: { 'auth.access-token': 'a', 'auth.session-meta': 'not json' },
    });

    await expect(session.restore()).resolves.toStrictEqual({
      status: 'signed-out',
      reason: 'corrupt',
    });
    expect(secureStorage.stored().size).toBe(2);
    expect(errorLog.recorded).toHaveLength(1);
  });

  it('restores once however often it is asked', async () => {
    const { session, secureStorage } = setup();

    session.start();
    await Promise.all([session.restore(), session.restore()]);

    expect(secureStorage.calls.filter((call) => call.operation === 'read')).toHaveLength(3);
  });
});

describe('signIn', () => {
  it('writes the tokens before it publishes the account', async () => {
    const { session, secureStorage } = setup({ stored: {} });
    await session.restore();
    const onDisk: (string | undefined)[] = [];
    session.subscribe(() => onDisk.push(secureStorage.stored().get(SECURE_KEYS.refreshToken)));

    const signedIn = await session.signIn({
      grant: { accessToken: 'a', refreshToken: 'r' },
      account: ACCOUNT,
    });

    expect([signedIn, onDisk]).toStrictEqual([{ ok: true, value: undefined }, ['r']]);
    expect(session.getSnapshot()).toStrictEqual({ status: 'signed-in', account: ACCOUNT });
  });

  it('publishes nothing when the write fails', async () => {
    const { session, secureStorage, seen } = setup({ stored: {} });
    await session.restore();
    secureStorage.failNext('write');

    const signedIn = await session.signIn({
      grant: { accessToken: 'a', refreshToken: 'r' },
      account: ACCOUNT,
    });

    expect(signedIn.ok).toBe(false);
    expect(seen).toStrictEqual([{ status: 'signed-out', reason: null }]);
    expect(secureStorage.stored().size).toBe(0);
  });

  it('lets a sign-out that starts during sign-in win: nothing is published or kept', async () => {
    const { session, secureStorage } = setup({ stored: {} });
    await session.restore();
    const release = secureStorage.holdWrites();

    const signingIn = session.signIn({
      grant: { accessToken: 'a', refreshToken: 'r' },
      account: ACCOUNT,
    });
    await flushMicrotasks();
    const signingOut = session.signOut('user');
    release();

    await expect(signingIn).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'sign-in-superseded' },
    });
    await signingOut;
    expect(secureStorage.stored().size).toBe(0);
    expect(session.getSnapshot()).toStrictEqual({ status: 'signed-out', reason: 'user' });
  });

  it('marks the install as known once every key was written', async () => {
    const { session, installMarker } = setup({ stored: {}, marker: { isPresent: false } });
    await session.signIn({ grant: { accessToken: 'a' }, account: ACCOUNT });

    expect(installMarker.isSet()).toBe(true);
  });
});

describe('access tokens and refresh', () => {
  it('refreshes once for every caller that needs a token meanwhile', async () => {
    const { session, oauth, clock } = setup();
    await session.restore();
    clock.advance(3_600_000);
    const answer = oauth.deferRefresh();

    const callers = Promise.all([
      session.accessToken(),
      session.accessToken(),
      session.accessToken(),
    ]);
    await flushMicrotasks();
    answer(ok({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresInSeconds: 3600 }));

    expect(await callers).toStrictEqual([
      { ok: true, value: 'access-2' },
      { ok: true, value: 'access-2' },
      { ok: true, value: 'access-2' },
    ]);
    expect(oauth.calls).toStrictEqual([{ method: 'refresh', refreshToken: 'refresh-1' }]);
  });

  it('writes a rotated refresh token first, before the new token is handed out', async () => {
    const { session, oauth, clock, secureStorage } = setup();
    await session.restore();
    clock.advance(3_600_000);
    oauth.answerRefresh(ok({ accessToken: 'access-2', refreshToken: 'refresh-2' }));

    await session.accessToken();

    const writes = secureStorage.calls.filter((call) => call.operation === 'write');
    expect(writes.map((call) => call.key)).toStrictEqual([
      SECURE_KEYS.refreshToken,
      SECURE_KEYS.accessToken,
      SECURE_KEYS.sessionMeta,
    ]);
    expect(secureStorage.stored().get(SECURE_KEYS.refreshToken)).toBe('refresh-2');
  });

  it('keeps the session through a failed connection and still sends an unexpired token', async () => {
    const { session, oauth, clock } = setup();
    await session.restore();
    clock.advance(3_600_000 - 30_000);
    oauth.answerRefresh(err({ kind: 'network-unavailable' }));
    const unexpired = await session.accessToken();
    clock.advance(60_000);
    oauth.answerRefresh(err({ kind: 'timed-out', afterMs: 15_000 }));
    const expired = await session.accessToken();

    expect([unexpired, expired]).toStrictEqual([
      { ok: true, value: 'access-1' },
      { ok: false, error: { kind: 'timed-out', afterMs: 15_000 } },
    ]);
    expect(session.getSnapshot().status).toBe('signed-in');
  });

  it('signs out when the refresh token is dead', async () => {
    const { session, oauth, clock, secureStorage } = setup();
    await session.restore();
    clock.advance(3_600_000);
    oauth.answerRefresh(err({ kind: 'invalid-grant' }));

    const token = await session.accessToken();

    expect(token).toStrictEqual({ ok: false, error: { kind: 'signed-out' } });
    expect(session.getSnapshot()).toStrictEqual({
      status: 'signed-out',
      reason: 'session-expired',
    });
    expect(secureStorage.stored().size).toBe(0);
  });

  it('records a refused client before signing out', async () => {
    const { session, oauth, clock, errorLog } = setup();
    await session.restore();
    clock.advance(3_600_000);
    oauth.answerRefresh(err({ kind: 'rejected', code: 'invalid_client' }));

    await session.accessToken();

    expect(errorLog.entries()[0]?.message).toBe('token refresh rejected: invalid_client');
    expect(session.getSnapshot().status).toBe('signed-out');
  });

  it('signs out an expired session that has no refresh token', async () => {
    const { session, clock, oauth } = setup({
      stored: { 'auth.access-token': 'access-1', 'auth.session-meta': META },
    });
    await session.restore();
    clock.advance(3_600_000);

    await expect(session.accessToken()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'signed-out' },
    });
    expect(oauth.calls).toStrictEqual([]);
  });

  it('drops a refresh that finishes after sign-out: no token is written back', async () => {
    const { session, oauth, clock, secureStorage } = setup();
    await session.restore();
    clock.advance(3_600_000);
    const answer = oauth.deferRefresh();

    const token = session.accessToken();
    await flushMicrotasks();
    await session.signOut('user');
    answer(ok({ accessToken: 'access-2', refreshToken: 'refresh-2' }));

    await expect(token).resolves.toStrictEqual({ ok: false, error: { kind: 'signed-out' } });
    expect(secureStorage.stored().size).toBe(0);
    expect(session.peekAccessToken()).toBeNull();
  });
});

describe('renewAfterUnauthorized', () => {
  it('refreshes for the token the server rejected, once', async () => {
    const { session, oauth } = setup();
    await session.restore();
    oauth.answerRefresh(ok({ accessToken: 'access-2' }));

    const first = await session.renewAfterUnauthorized('access-1');
    const late = await session.renewAfterUnauthorized('access-1');

    expect([first, late]).toStrictEqual([
      { ok: true, value: 'access-2' },
      { ok: true, value: 'access-2' },
    ]);
    expect(oauth.calls).toHaveLength(1);
  });

  it('answers signed-out without a session', async () => {
    const { session } = setup({ stored: {} });
    await session.restore();

    await expect(session.renewAfterUnauthorized('x')).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'signed-out' },
    });
  });
});
