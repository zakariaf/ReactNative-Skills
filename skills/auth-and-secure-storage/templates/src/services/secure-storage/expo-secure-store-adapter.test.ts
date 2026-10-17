// src/services/secure-storage/expo-secure-store-adapter.test.ts
// Drives the adapter against Jest's automock of expo-secure-store (read with a typed requireMock).
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { createExpoSecureStoreAdapter, SECURE_STORE_OPTIONS } from './expo-secure-store-adapter';
import { SECURE_KEYS } from './secure-key-names';

jest.mock('expo-secure-store');

type MockedSecureStore = {
  readonly AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: number;
  readonly getItemAsync: jest.Mock<Promise<string | null>, [string, object]>;
  readonly setItemAsync: jest.Mock<Promise<void>, [string, string, object]>;
  readonly deleteItemAsync: jest.Mock<Promise<void>, [string, object]>;
};

const secureStorage = jest.requireMock<MockedSecureStore>('expo-secure-store');

function createAdapter(): {
  readonly store: ReturnType<typeof createExpoSecureStoreAdapter>;
  readonly errorLog: ReturnType<typeof createFakeErrorLog>;
} {
  const errorLog = createFakeErrorLog();
  return { store: createExpoSecureStoreAdapter({ errorLog }), errorLog };
}

describe('createExpoSecureStoreAdapter', () => {
  it('reads, writes and removes with the one options object', async () => {
    secureStorage.getItemAsync.mockResolvedValueOnce('stored');
    const { store } = createAdapter();

    const read = await store.read(SECURE_KEYS.refreshToken);
    await store.write(SECURE_KEYS.refreshToken, 'next');
    await store.remove(SECURE_KEYS.refreshToken);

    expect(read).toStrictEqual({ ok: true, value: 'stored' });
    expect(secureStorage.getItemAsync).toHaveBeenLastCalledWith(
      'auth.refresh-token',
      SECURE_STORE_OPTIONS,
    );
    expect(secureStorage.setItemAsync).toHaveBeenLastCalledWith(
      'auth.refresh-token',
      'next',
      SECURE_STORE_OPTIONS,
    );
    expect(secureStorage.deleteItemAsync).toHaveBeenLastCalledWith(
      'auth.refresh-token',
      SECURE_STORE_OPTIONS,
    );
  });

  it('keeps secrets readable in the background and on this device only', () => {
    expect(SECURE_STORE_OPTIONS).toStrictEqual({
      keychainAccessible: secureStorage.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    expect(Object.isFrozen(SECURE_STORE_OPTIONS)).toBe(true);
  });

  it('turns a rejected read into a failure and records it without the value', async () => {
    secureStorage.getItemAsync.mockRejectedValueOnce(new Error('User interaction is not allowed.'));
    secureStorage.setItemAsync.mockRejectedValueOnce('keystore refused');
    const { store, errorLog } = createAdapter();

    const read = await store.read(SECURE_KEYS.accessToken);
    const written = await store.write(SECURE_KEYS.accessToken, 'secret-access-value');

    expect([read, written]).toStrictEqual([
      { ok: false, error: { kind: 'secure-storage-unavailable', operation: 'read' } },
      { ok: false, error: { kind: 'secure-storage-unavailable', operation: 'write' } },
    ]);
    const messages = errorLog.entries().map((entry) => entry.message);
    expect(messages).toStrictEqual([
      'secure store write auth.access-token: keystore refused',
      'secure store read auth.access-token: User interaction is not allowed.',
    ]);
    expect(messages.join(' ')).not.toContain('secret-access-value');
  });

  it('reports a failed remove as a remove failure', async () => {
    secureStorage.deleteItemAsync.mockRejectedValueOnce(new Error('Could not delete the item'));
    const { store } = createAdapter();

    await expect(store.remove(SECURE_KEYS.sessionMeta)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'secure-storage-unavailable', operation: 'remove' },
    });
  });
});
