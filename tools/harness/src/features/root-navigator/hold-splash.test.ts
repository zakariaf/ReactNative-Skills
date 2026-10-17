// src/features/root-navigator/hold-splash.test.ts
// The splash hold runs once, as a side effect of being imported, and a rejection reaches the error net.
import { flushMicrotasks } from '@test/flush-microtasks';

jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn() }));
jest.mock('@/services/error-net/app-error-net', () => ({ appErrorNet: { report: jest.fn() } }));

type SplashModule = { readonly preventAutoHideAsync: jest.Mock<Promise<boolean>> };
type NetModule = { readonly appErrorNet: { readonly report: jest.Mock } };
type Loaded = { readonly hold: jest.Mock<Promise<boolean>>; readonly report: jest.Mock };

/** Imports hold-splash in a fresh module registry whose preventAutoHideAsync answers `answer`. */
function importWith(answer: () => Promise<boolean>, times = 1): Loaded {
  const box: { loaded?: Loaded } = {};
  jest.isolateModules(() => {
    const splash = jest.requireMock<SplashModule>('expo-splash-screen');
    const net = jest.requireMock<NetModule>('@/services/error-net/app-error-net');
    splash.preventAutoHideAsync.mockImplementation(answer);
    for (let index = 0; index < times; index += 1) require('./hold-splash');
    box.loaded = { hold: splash.preventAutoHideAsync, report: net.appErrorNet.report };
  });
  if (box.loaded === undefined) throw new Error('hold-splash did not load');
  return box.loaded;
}

describe('hold-splash', () => {
  it('holds the native splash once, at import, however often it is imported', async () => {
    const { hold, report } = importWith(() => Promise.resolve(true), 2);
    await flushMicrotasks();
    expect(hold).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
  });

  it('hands a rejected hold to the error net instead of dropping it', async () => {
    const failure = new Error('splash module failed');
    const { report } = importWith(() => Promise.reject(failure));
    await flushMicrotasks();
    expect(report).toHaveBeenCalledWith({
      source: 'unhandled-rejection',
      error: failure,
      isFatal: false,
    });
  });
});
