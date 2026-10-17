// src/services/install-marker/kv-install-marker-adapter.test.ts
// Drives the adapter against a mock of expo-sqlite/kv-store's synchronous API (read with a typed
// requireMock); the stored values live in a Map, the way kv-store keeps one row per key.
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { createKvInstallMarkerAdapter, INSTALL_MARKER_KEY } from './kv-install-marker-adapter';

jest.mock('expo-sqlite/kv-store', () => {
  const rows = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      rows,
      getItemSync: jest.fn((key: string) => rows.get(key) ?? null),
      setItemSync: jest.fn((key: string, value: string) => {
        rows.set(key, value);
      }),
      removeItemSync: jest.fn((key: string) => rows.delete(key)),
    },
  };
});

type MockedKvStore = {
  readonly default: {
    readonly rows: Map<string, string>;
    readonly getItemSync: jest.Mock<string | null, [string]>;
    readonly setItemSync: jest.Mock<void, [string, string]>;
  };
};

const kv = jest.requireMock<MockedKvStore>('expo-sqlite/kv-store').default;

describe('createKvInstallMarkerAdapter', () => {
  beforeEach(() => {
    kv.rows.clear();
  });

  it('is absent on a fresh install, present after write, absent again after clear', () => {
    const marker = createKvInstallMarkerAdapter({ errorLog: createFakeErrorLog() });

    const fresh = marker.isPresent();
    marker.write();
    const written = marker.isPresent();
    marker.clear();

    expect([fresh, written, marker.isPresent()]).toStrictEqual([
      { ok: true, value: false },
      { ok: true, value: true },
      { ok: true, value: false },
    ]);
    expect(kv.setItemSync).toHaveBeenCalledWith(INSTALL_MARKER_KEY, '1');
  });

  it('reports an unreadable store as a failure, not as a fresh install', () => {
    const errorLog = createFakeErrorLog();
    kv.getItemSync.mockImplementationOnce(() => {
      throw new Error('disk I/O error');
    });
    kv.setItemSync.mockImplementationOnce(() => {
      throw new Error('database is locked');
    });
    const marker = createKvInstallMarkerAdapter({ errorLog });

    expect([marker.isPresent(), marker.write()]).toStrictEqual([
      { ok: false, error: { kind: 'install-marker-unavailable' } },
      { ok: false, error: { kind: 'install-marker-unavailable' } },
    ]);
    expect(errorLog.entries().map((entry) => entry.message)).toStrictEqual([
      'database is locked',
      'disk I/O error',
    ]);
  });
});
