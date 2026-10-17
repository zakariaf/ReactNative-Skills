// src/services/error-net/window-error-hooks.test.ts
import { createErrorNet } from './error-net';
import { readWindowErrorHooks } from './window-error-hooks';

import type { ErrorReport } from './error-net';

/** An `error` event as a browser builds it (Node has no ErrorEvent class). */
function errorEvent(fields: { readonly error?: unknown; readonly message?: string }): Event {
  return Object.assign(new Event('error'), fields);
}

function rejectionEvent(reason: unknown): Event {
  return Object.assign(new Event('unhandledrejection'), { reason });
}

function installedNet(target: EventTarget): readonly ErrorReport[] {
  const reports: ErrorReport[] = [];
  const net = createErrorNet(readWindowErrorHooks(target), { bufferSize: 5 });
  net.install();
  net.connect((report) => {
    reports.push(report);
  });
  return reports;
}

describe('readWindowErrorHooks', () => {
  it('records an uncaught error from the window error event, never as fatal', () => {
    const target = new EventTarget();
    const reports = installedNet(target);
    const thrown = new Error('boom');

    target.dispatchEvent(errorEvent({ error: thrown, message: 'Uncaught Error: boom' }));

    expect(reports).toStrictEqual([{ source: 'global-handler', error: thrown, isFatal: false }]);
  });

  it('falls back to the message for a cross-origin script error', () => {
    const target = new EventTarget();
    const reports = installedNet(target);

    target.dispatchEvent(errorEvent({ error: null, message: 'Script error.' }));

    expect(reports).toStrictEqual([
      { source: 'global-handler', error: 'Script error.', isFatal: false },
    ]);
  });

  it('records an unhandled rejection with its reason', () => {
    const target = new EventTarget();
    const reports = installedNet(target);
    const reason = new Error('rejected');

    target.dispatchEvent(rejectionEvent(reason));

    expect(reports).toStrictEqual([
      { source: 'unhandled-rejection', error: reason, isFatal: false },
    ]);
  });

  it('stops recording once the net is uninstalled', () => {
    const target = new EventTarget();
    const reports: ErrorReport[] = [];
    const net = createErrorNet(readWindowErrorHooks(target), { bufferSize: 5 });
    const uninstall = net.install();
    net.connect((report) => {
      reports.push(report);
    });

    uninstall();
    target.dispatchEvent(errorEvent({ error: new Error('late') }));
    target.dispatchEvent(rejectionEvent('late'));

    expect(reports).toStrictEqual([]);
  });

  it('installs nothing without a window (static rendering in Node)', () => {
    const hooks = readWindowErrorHooks(undefined);

    expect(hooks.errorUtils).toBeNull();
    expect(hooks.enableRejectionTracker).toBeNull();
  });

  it('logs through console.error when the sink itself throws', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const hooks = readWindowErrorHooks(undefined);

    hooks.fallbackLog('error-net: the error sink threw', 'cause');

    expect(spy).toHaveBeenCalledWith('error-net: the error sink threw', 'cause');
  });
});
