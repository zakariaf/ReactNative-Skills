// src/services/debug-storage/fake-debug-storage.test.ts
import { createFakeDebugStorage } from './fake-debug-storage';

describe('createFakeDebugStorage', () => {
  it('starts with the given text and keeps what is written', () => {
    const storage = createFakeDebugStorage('{}');

    expect(storage.read()).toStrictEqual({ ok: true, value: '{}' });

    storage.write(null);

    expect(storage.stored()).toBeNull();
  });

  it('fails reads or writes on request, like the adapter does', () => {
    const storage = createFakeDebugStorage();
    storage.failOn('read');

    expect(storage.read()).toStrictEqual({
      ok: false,
      error: { kind: 'debug-storage-unreadable' },
    });

    storage.failOn('write');

    expect(storage.write('{}')).toStrictEqual({
      ok: false,
      error: { kind: 'debug-storage-not-saved' },
    });
    expect(storage.stored()).toBeNull();
  });
});
