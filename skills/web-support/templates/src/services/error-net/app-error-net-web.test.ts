// src/services/error-net/app-error-net-web.test.ts
// Tests app-error-net.web.ts. Loads the web file by its full name (the Jest projects resolve modules the way iOS does), each
// time in a fresh module registry, after putting an EventTarget where the browser's window would be.
import type * as WebErrorNet from './app-error-net.web';
import type { ErrorReport } from './error-net';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

function loadWithWindow(target: EventTarget | undefined): typeof WebErrorNet {
  Object.defineProperty(globalThis, 'window', {
    value: target,
    configurable: true,
    writable: true,
  });
  let loaded: typeof WebErrorNet | undefined;
  jest.isolateModules(() => {
    loaded = jest.requireActual<typeof WebErrorNet>('./app-error-net.web');
  });
  if (loaded === undefined) throw new Error('app-error-net.web did not load');
  return loaded;
}

describe('appErrorNet (web)', () => {
  afterEach(() => {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });

  it('records what the window reports once installed and connected', () => {
    const target = new EventTarget();
    const { appErrorNet } = loadWithWindow(target);
    const reports: ErrorReport[] = [];
    const uninstall = appErrorNet.install();
    appErrorNet.connect((report) => {
      reports.push(report);
    });
    const thrown = new Error('boom');

    target.dispatchEvent(Object.assign(new Event('error'), { error: thrown }));
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'late' }));
    uninstall();

    expect(reports).toStrictEqual([
      { source: 'global-handler', error: thrown, isFatal: false },
      { source: 'unhandled-rejection', error: 'late', isFatal: false },
    ]);
  });

  it('installs nothing while static rendering runs without a window', () => {
    const { appErrorNet } = loadWithWindow(undefined);

    const uninstall = appErrorNet.install();

    expect(uninstall).toBeInstanceOf(Function);
    expect(() => {
      uninstall();
    }).not.toThrow();
  });
});
