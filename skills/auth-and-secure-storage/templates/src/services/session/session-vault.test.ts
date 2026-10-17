// src/services/session/session-vault.test.ts
import { createFakeSecureStorage } from '@/services/secure-storage/fake-secure-storage';
import { SECURE_KEYS } from '@/services/secure-storage/secure-key-names';

import { readSession, wipeSession, writeSession } from './session-vault';

import type { StoredSession } from './session-vault';

const SESSION: StoredSession = {
  tokens: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAtMs: 5_000 },
  account: { id: 'acc-1', displayName: 'Robin' },
};

describe('session vault', () => {
  it('writes the refresh token first and reads the same session back', async () => {
    const store = createFakeSecureStorage();

    await writeSession(store, SESSION);

    expect(store.calls.map((call) => call.key)).toStrictEqual([
      SECURE_KEYS.refreshToken,
      SECURE_KEYS.accessToken,
      SECURE_KEYS.sessionMeta,
    ]);
    await expect(readSession(store)).resolves.toStrictEqual({
      ok: true,
      value: { kind: 'found', session: SESSION },
    });
  });

  it('keeps no token in the meta value', async () => {
    const store = createFakeSecureStorage();

    await writeSession(store, SESSION);

    expect(store.stored().get(SECURE_KEYS.sessionMeta)).toBe(
      '{"version":1,"expiresAtMs":5000,"account":{"id":"acc-1","displayName":"Robin"}}',
    );
  });

  it('removes a stale refresh token when the session has none', async () => {
    const store = createFakeSecureStorage({ 'auth.refresh-token': 'stale' });

    await writeSession(store, { ...SESSION, tokens: { ...SESSION.tokens, refreshToken: null } });

    expect(store.stored().has(SECURE_KEYS.refreshToken)).toBe(false);
  });

  it('tells empty from corrupt', async () => {
    const empty = await readSession(createFakeSecureStorage());
    const noAccess = await readSession(createFakeSecureStorage({ 'auth.refresh-token': 'r' }));
    const badMeta = await readSession(
      createFakeSecureStorage({ 'auth.access-token': 'a', 'auth.session-meta': '{not json' }),
    );
    const wrongShape = await readSession(
      createFakeSecureStorage({ 'auth.access-token': 'a', 'auth.session-meta': '{"version":9}' }),
    );

    expect([empty, noAccess, badMeta, wrongShape]).toStrictEqual([
      { ok: true, value: { kind: 'empty' } },
      { ok: true, value: { kind: 'corrupt' } },
      { ok: true, value: { kind: 'corrupt' } },
      { ok: true, value: { kind: 'corrupt' } },
    ]);
  });

  it('returns a failed read as a failure, never as empty', async () => {
    const store = createFakeSecureStorage();
    store.failNext('read');

    await expect(readSession(store)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'secure-storage-unavailable', operation: 'read' },
    });
  });

  it('stops writing at the first failure', async () => {
    const store = createFakeSecureStorage();
    store.failNext('write');

    const written = await writeSession(store, SESSION);

    expect(written.ok).toBe(false);
    expect(store.calls).toHaveLength(1);
  });

  it('wipes every declared key even when one removal fails', async () => {
    const store = createFakeSecureStorage();
    await writeSession(store, SESSION);
    store.failNext('remove');

    const wiped = await wipeSession(store);

    expect(wiped).toStrictEqual({
      ok: false,
      error: { kind: 'secure-storage-unavailable', operation: 'remove' },
    });
    expect(store.calls.filter((call) => call.operation === 'remove')).toHaveLength(3);
  });

  it('wipes cleanly', async () => {
    const store = createFakeSecureStorage();
    await writeSession(store, SESSION);

    await expect(wipeSession(store)).resolves.toStrictEqual({ ok: true, value: undefined });
    expect(store.stored().size).toBe(0);
  });
});
