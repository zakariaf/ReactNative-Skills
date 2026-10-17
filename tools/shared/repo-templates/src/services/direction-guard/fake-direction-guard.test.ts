// src/services/direction-guard/fake-direction-guard.test.ts
import { createFakeDirectionGuard } from './fake-direction-guard';

describe('createFakeDirectionGuard', () => {
  it('starts with the seeded pending direction', () => {
    expect(createFakeDirectionGuard().readPending()).toBeNull();
    expect(createFakeDirectionGuard({ pending: 'rtl' }).readPending()).toBe('rtl');
  });

  it('keeps every write in order and reads back the last one', () => {
    const guard = createFakeDirectionGuard();

    expect(guard.writePending('rtl')).toStrictEqual({ ok: true, value: undefined });
    guard.writePending(null);

    expect(guard.writes).toStrictEqual(['rtl', null]);
    expect(guard.readPending()).toBeNull();
  });

  it('fails every write when told to, and keeps the old value', () => {
    const guard = createFakeDirectionGuard({ pending: 'ltr', isWriteFailing: true });

    expect(guard.writePending('rtl')).toStrictEqual({
      ok: false,
      error: { kind: 'direction-guard-not-saved' },
    });
    expect(guard.readPending()).toBe('ltr');
    expect(guard.writes).toStrictEqual([]);
  });

  it('reports every read as unreadable when told to, while writes still succeed', () => {
    const guard = createFakeDirectionGuard({ pending: 'rtl', isReadFailing: true });

    expect(guard.readPending()).toBe('unreadable');
    expect(guard.writePending(null)).toStrictEqual({ ok: true, value: undefined });
    expect(guard.readPending()).toBe('unreadable');
  });
});
