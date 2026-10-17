// src/services/settings-storage/fake-settings-storage.test.ts
import { createFakeSettingsStorage } from '@/services/settings-storage/fake-settings-storage';

describe('createFakeSettingsStorage', () => {
  it('reads null before the first write, then the last text written', () => {
    const storage = createFakeSettingsStorage();

    expect(storage.read()).toStrictEqual({ ok: true, value: null });
    expect(storage.write('{"theme":"dark"}')).toStrictEqual({ ok: true, value: undefined });
    expect(storage.read()).toStrictEqual({ ok: true, value: '{"theme":"dark"}' });
    expect(storage.writes).toStrictEqual(['{"theme":"dark"}']);
  });

  it('starts from seeded text', () => {
    expect(createFakeSettingsStorage({ text: '{}' }).saved()).toBe('{}');
  });

  it('fails reads and writes on request, and keeps the text on a failed write', () => {
    const storage = createFakeSettingsStorage({
      text: '{}',
      isReadFailing: true,
      isWriteFailing: true,
    });

    expect(storage.read()).toStrictEqual({ ok: false, error: { kind: 'settings-unreadable' } });
    expect(storage.write('{"theme":"dark"}')).toStrictEqual({
      ok: false,
      error: { kind: 'settings-not-saved' },
    });
    expect(storage.saved()).toBe('{}');
    expect(storage.writes).toStrictEqual([]);
  });
});
