// src/i18n/direction-web.test.ts
// Tests direction.web.ts, imported by its full name (the Jest projects resolve modules the way iOS
// does). Jest runs in Node, so a small document and localStorage stand in for the browser's and are
// removed after each test.
import { createFakeDirectionGuard } from '@/services/direction-guard/fake-direction-guard';

import { forceLayoutDirection, readLayoutDirection, restartForDirection } from './direction.web';

/** The localStorage key direction.web.ts keeps the forced direction under. */
const LAYOUT_DIRECTION_KEY = 'app.layout-direction';

type FakeStorage = { readonly values: Map<string, string>; isBlocked: boolean };

const STAND_INS = ['document', 'localStorage'] as const;
const originals = STAND_INS.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));

/** A page whose <html dir> starts as given, and a localStorage that can be blocked. */
function usePage(
  dir: string,
  saved?: string,
): { readonly root: { dir: string }; readonly storage: FakeStorage } {
  const root = { dir };
  const storage: FakeStorage = { values: new Map(), isBlocked: false };
  if (saved !== undefined) storage.values.set(LAYOUT_DIRECTION_KEY, saved);
  const blockedOr = <T>(read: () => T): T => {
    if (storage.isBlocked) throw new Error('SecurityError: access to localStorage is denied');
    return read();
  };
  Object.defineProperty(globalThis, 'document', {
    value: { documentElement: root },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => blockedOr(() => storage.values.get(key) ?? null),
      setItem: (key: string, value: string) => {
        blockedOr(() => storage.values.set(key, value));
      },
    },
    configurable: true,
  });
  return { root, storage };
}

/** expo's reloadAppAsync calls the global expo object; spy there instead of mocking the package. */
function spyOnReload(): jest.SpyInstance {
  return jest.spyOn(globalThis.expo, 'reloadAppAsync').mockResolvedValue(undefined);
}

function restoreStandIns(): void {
  STAND_INS.forEach((name, index) => {
    const original = originals[index];
    if (original) Object.defineProperty(globalThis, name, original);
    else Reflect.deleteProperty(globalThis, name);
  });
}

describe('direction (web)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    restoreStandIns();
  });

  describe('readLayoutDirection', () => {
    it('reads the dir of <html> on a first visit', () => {
      usePage('rtl');

      expect(readLayoutDirection()).toBe('rtl');
    });

    it('prefers the saved direction and puts it back on <html>', () => {
      const { root } = usePage('ltr', 'rtl');

      expect(readLayoutDirection()).toBe('rtl');
      expect(root.dir).toBe('rtl');
    });

    it('falls back to <html dir> when the browser blocks storage', () => {
      const { storage } = usePage('ltr', 'rtl');
      storage.isBlocked = true;

      expect(readLayoutDirection()).toBe('ltr');
    });

    it('answers left to right during static rendering, where there is no document', () => {
      expect(readLayoutDirection()).toBe('ltr');
    });
  });

  describe('forceLayoutDirection', () => {
    it('sets <html dir> and saves it for the next load', () => {
      const { root, storage } = usePage('ltr');

      forceLayoutDirection('rtl');

      expect(root.dir).toBe('rtl');
      expect(storage.values.get(LAYOUT_DIRECTION_KEY)).toBe('rtl');
    });

    it('flips the page even when the browser blocks storage', () => {
      const { root, storage } = usePage('ltr');
      storage.isBlocked = true;

      forceLayoutDirection('rtl');

      expect(root.dir).toBe('rtl');
    });
  });

  describe('restartForDirection', () => {
    it('records the pending direction, flips the page, then reloads once', async () => {
      const reload = spyOnReload();
      const { root } = usePage('ltr');
      const guard = createFakeDirectionGuard();

      const result = await restartForDirection('rtl', guard);

      expect(result.ok).toBe(true);
      expect(guard.writes).toStrictEqual(['rtl']);
      expect(root.dir).toBe('rtl');
      expect(reload).toHaveBeenCalledWith('layout direction -> rtl');
    });

    it('leaves the page and skips the reload when the record cannot be written', async () => {
      const reload = spyOnReload();
      const { root } = usePage('ltr');

      const result = await restartForDirection(
        'rtl',
        createFakeDirectionGuard({ isWriteFailing: true }),
      );

      expect(result).toStrictEqual({ ok: false, error: { kind: 'direction-guard-not-saved' } });
      expect(root.dir).toBe('ltr');
      expect(reload).not.toHaveBeenCalled();
    });

    it('reloads after a rejected beforeReload and passes the rejection on', async () => {
      const reload = spyOnReload();
      usePage('ltr');

      await expect(
        restartForDirection('rtl', createFakeDirectionGuard(), () =>
          Promise.reject(new Error('busy')),
        ),
      ).rejects.toThrow('busy');

      expect(reload).toHaveBeenCalledTimes(1);
    });
  });
});
