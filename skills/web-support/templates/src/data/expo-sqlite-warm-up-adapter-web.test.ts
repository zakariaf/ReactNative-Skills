// src/data/expo-sqlite-warm-up-adapter-web.test.ts
// Tests expo-sqlite-warm-up-adapter.web.ts, loaded by its full name (the Jest projects resolve
// modules the way iOS does) in a fresh module registry per test, because the adapter keeps one
// warm-up per page in module state. Only adapters import expo-sqlite, so its mock forwards to a
// mock function here; a fake LockManager and crossOriginIsolated stand in for the browser.
import type * as WebWarmUp from './expo-sqlite-warm-up-adapter.web';

const mockOpenDatabaseAsync = jest.fn<Promise<unknown>, [string]>();

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: (name: string) => mockOpenDatabaseAsync(name),
}));

type LockCallback = (lock: { readonly name: string } | null) => unknown;

const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
const originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');
const originalIsolated = Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated');

/** A LockManager whose lock is free (then held by the first request) or held by another tab. */
function useLocks(isHeldElsewhere: boolean): string[] {
  const names: string[] = [];
  let isHeld = isHeldElsewhere;
  const locks = {
    request: (name: string, _options: unknown, callback: LockCallback) => {
      names.push(name);
      const lock = isHeld ? null : { name };
      isHeld = true;
      // Like the browser's: settles when the callback's promise does (never, while the lock is held).
      return Promise.resolve(callback(lock));
    },
  };
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
  return names;
}

/** navigator.storage whose origin private file system opens, or fails as in private browsing. */
function useFileSystem(isAvailable: boolean): void {
  const storage = {
    getDirectory: () =>
      isAvailable ? Promise.resolve({}) : Promise.reject(new Error('UnknownError')),
  };
  Object.defineProperty(navigator, 'storage', { value: storage, configurable: true });
}

function useIsolation(isIsolated: boolean): void {
  Object.defineProperty(globalThis, 'crossOriginIsolated', {
    value: isIsolated,
    configurable: true,
  });
}

/** A fresh copy of the adapter (no warm-up started yet) and its warm-up. */
function loadWarmUp(): () => Promise<string> {
  let loaded: typeof WebWarmUp | undefined;
  jest.isolateModules(() => {
    loaded = jest.requireActual<typeof WebWarmUp>('./expo-sqlite-warm-up-adapter.web');
  });
  const run = loaded?.createExpoSqliteWarmUpAdapter();
  if (run === null || run === undefined) throw new Error('the web adapter always has a warm-up');
  return run;
}

describe('createExpoSqliteWarmUpAdapter (web)', () => {
  beforeEach(() => {
    mockOpenDatabaseAsync.mockReset();
    useIsolation(true);
    useFileSystem(true);
  });

  afterEach(() => {
    if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
    else Reflect.deleteProperty(navigator, 'locks');
    if (originalStorage) Object.defineProperty(navigator, 'storage', originalStorage);
    else Reflect.deleteProperty(navigator, 'storage');
    if (originalIsolated)
      Object.defineProperty(globalThis, 'crossOriginIsolated', originalIsolated);
    else Reflect.deleteProperty(globalThis, 'crossOriginIsolated');
  });

  it('takes the storage lock, then opens and closes one in-memory database', async () => {
    const names = useLocks(false);
    const closeAsync = jest.fn(() => Promise.resolve());
    mockOpenDatabaseAsync.mockResolvedValue({ closeAsync });

    await expect(loadWarmUp()()).resolves.toBe('ready');

    expect(names).toStrictEqual(['app-storage']);
    expect(mockOpenDatabaseAsync).toHaveBeenCalledWith(':memory:');
    expect(closeAsync).toHaveBeenCalledTimes(1);
  });

  it('answers ready again in the same tab, without asking for the lock twice', async () => {
    const names = useLocks(false);
    mockOpenDatabaseAsync.mockResolvedValue({ closeAsync: () => Promise.resolve() });
    const warmUp = loadWarmUp();

    await expect(warmUp()).resolves.toBe('ready');
    await expect(warmUp()).resolves.toBe('ready');

    expect(names).toStrictEqual(['app-storage']);
    expect(mockOpenDatabaseAsync).toHaveBeenCalledTimes(1);
  });

  it('touches no storage while another tab holds the lock', async () => {
    useLocks(true);

    await expect(loadWarmUp()()).resolves.toBe('in-use-elsewhere');

    expect(mockOpenDatabaseAsync).not.toHaveBeenCalled();
  });

  it('reports unsupported, touching nothing, when the page is not cross-origin isolated', async () => {
    const names = useLocks(false);
    useIsolation(false);

    await expect(loadWarmUp()()).resolves.toBe('unsupported');

    expect(names).toStrictEqual([]);
    expect(mockOpenDatabaseAsync).not.toHaveBeenCalled();
  });

  it('reports unsupported when the browser gives the page no private file system', async () => {
    useLocks(false);
    useFileSystem(false);

    await expect(loadWarmUp()()).resolves.toBe('unsupported');

    expect(mockOpenDatabaseAsync).not.toHaveBeenCalled();
  });

  it('rejects when the worker cannot start', async () => {
    useLocks(false);
    mockOpenDatabaseAsync.mockRejectedValue(new Error('worker failed'));

    await expect(loadWarmUp()()).rejects.toThrow('worker failed');
  });
});
