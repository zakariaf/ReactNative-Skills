// src/services/debug-storage/kv-debug-storage-adapter.test.ts
// kv-store's synchronous calls replaced by a Map (the adapter's whole job is mapping them and their
// throws); the store's own SQL is expo-sqlite's, tested there.
import { DEBUG_OVERRIDES_KEY, createKvDebugStorageAdapter } from './kv-debug-storage-adapter';

const mockItems = new Map<string, string>();
let isMockFailing = false;

function mockFailIfAsked(): void {
  if (isMockFailing) throw new Error('disk I/O error');
}

jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItemSync: (key: string) => {
      mockFailIfAsked();
      return mockItems.get(key) ?? null;
    },
    setItemSync: (key: string, value: string) => {
      mockFailIfAsked();
      mockItems.set(key, value);
    },
    removeItemSync: (key: string) => {
      mockFailIfAsked();
      mockItems.delete(key);
    },
  },
}));

describe('createKvDebugStorageAdapter', () => {
  beforeEach(() => {
    mockItems.clear();
    isMockFailing = false;
  });

  it('reads null before anything is stored', () => {
    expect(createKvDebugStorageAdapter().read()).toStrictEqual({ ok: true, value: null });
  });

  it('keeps the text under its own key across adapters (a reload)', () => {
    createKvDebugStorageAdapter().write('{"isOffline":true}');

    expect(mockItems.get(DEBUG_OVERRIDES_KEY)).toBe('{"isOffline":true}');
    expect(createKvDebugStorageAdapter().read()).toStrictEqual({
      ok: true,
      value: '{"isOffline":true}',
    });
  });

  it('removes the text when given null', () => {
    const storage = createKvDebugStorageAdapter();
    storage.write('{}');
    storage.write(null);

    expect(storage.read()).toStrictEqual({ ok: true, value: null });
  });

  it('turns a failed read or write into a failure instead of a throw', () => {
    const storage = createKvDebugStorageAdapter();
    isMockFailing = true;

    expect(storage.read()).toStrictEqual({
      ok: false,
      error: { kind: 'debug-storage-unreadable' },
    });
    expect(storage.write('{}')).toStrictEqual({
      ok: false,
      error: { kind: 'debug-storage-not-saved' },
    });
  });
});
