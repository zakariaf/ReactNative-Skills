// src/services/secure-storage/fake-secure-storage.test.ts
import { flushMicrotasks } from '@test/flush-microtasks';

import { createFakeSecureStorage } from './fake-secure-storage';
import { SECURE_KEYS } from './secure-key-names';

describe('createFakeSecureStorage', () => {
  it('stores, reads and removes values and logs every call', async () => {
    const store = createFakeSecureStorage({ 'auth.refresh-token': 'seeded' });

    const seeded = await store.read(SECURE_KEYS.refreshToken);
    await store.write(SECURE_KEYS.accessToken, 'access');
    await store.remove(SECURE_KEYS.refreshToken);

    expect(seeded).toStrictEqual({ ok: true, value: 'seeded' });
    expect([...store.stored()]).toStrictEqual([['auth.access-token', 'access']]);
    expect(store.calls).toStrictEqual([
      { operation: 'read', key: 'auth.refresh-token' },
      { operation: 'write', key: 'auth.access-token', value: 'access' },
      { operation: 'remove', key: 'auth.refresh-token' },
    ]);
  });

  it('fails the chosen operation until told otherwise', async () => {
    const store = createFakeSecureStorage();
    const failed = { kind: 'secure-storage-unavailable' };

    store.failNext('write');
    const written = await store.write(SECURE_KEYS.accessToken, 'x');
    store.failNext('read');
    const read = await store.read(SECURE_KEYS.accessToken);
    store.failNext('remove');
    const removed = await store.remove(SECURE_KEYS.accessToken);
    store.failNext(null);

    expect([written, read, removed]).toStrictEqual([
      { ok: false, error: { ...failed, operation: 'write' } },
      { ok: false, error: { ...failed, operation: 'read' } },
      { ok: false, error: { ...failed, operation: 'remove' } },
    ]);
    await expect(store.read(SECURE_KEYS.accessToken)).resolves.toStrictEqual({
      ok: true,
      value: null,
    });
  });

  it('holds writes until released', async () => {
    const store = createFakeSecureStorage();
    const release = store.holdWrites();

    const pending = store.write(SECURE_KEYS.accessToken, 'late');
    await flushMicrotasks();
    const before = store.stored().size;
    release();
    await pending;

    expect([before, store.stored().get(SECURE_KEYS.accessToken)]).toStrictEqual([0, 'late']);
  });
});
