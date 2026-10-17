// src/services/error-net/error-net.test.ts
import { createErrorNet, readGlobalErrorHooks } from './error-net';

import type { ErrorNetHooks, ErrorReport, RejectionTrackerOptions } from './error-net';

type Handler = (error: unknown, isFatal: boolean) => void;

/** Fake React Native ErrorUtils and Hermes tracker that record what the net does with them. */
function createFakeHooks(): {
  readonly hooks: ErrorNetHooks;
  readonly forwarded: { error: unknown; isFatal: boolean }[];
  readonly fallback: unknown[];
  readonly current: () => Handler;
  readonly tracker: () => RejectionTrackerOptions | null;
} {
  const forwarded: { error: unknown; isFatal: boolean }[] = [];
  const fallback: unknown[] = [];
  const reactNativeDefault: Handler = (error, isFatal) => {
    forwarded.push({ error, isFatal });
  };
  let handler: Handler = reactNativeDefault;
  let tracker: RejectionTrackerOptions | null = null;
  const hooks: ErrorNetHooks = {
    errorUtils: {
      getGlobalHandler: () => handler,
      setGlobalHandler: (next) => {
        handler = next;
      },
    },
    enableRejectionTracker: (options) => {
      tracker = options;
    },
    fallbackLog: (_message, error) => {
      fallback.push(error);
    },
  };
  return { hooks, forwarded, fallback, current: () => handler, tracker: () => tracker };
}

describe('createErrorNet', () => {
  it('records an uncaught error, then hands it to the previous handler with its fatality', () => {
    const fake = createFakeHooks();
    const net = createErrorNet(fake.hooks, { bufferSize: 10 });
    const sink: ErrorReport[] = [];
    net.connect((report) => sink.push(report));
    net.install();
    const boom = new Error('boom');

    fake.current()(boom, true);

    expect(sink).toStrictEqual([{ source: 'global-handler', error: boom, isFatal: true }]);
    expect(fake.forwarded).toStrictEqual([{ error: boom, isFatal: true }]);
  });

  it('turns on rejection tracking for every rejection and records an unhandled one as non-fatal', () => {
    const fake = createFakeHooks();
    const net = createErrorNet(fake.hooks, { bufferSize: 10 });
    const sink: ErrorReport[] = [];
    net.connect((report) => sink.push(report));
    net.install();
    const rejection = new Error('offline');

    expect(fake.tracker()?.allRejections).toBe(true);
    fake.tracker()?.onUnhandled(1, rejection);
    fake.tracker()?.onHandled(1);

    expect(sink).toStrictEqual([
      { source: 'unhandled-rejection', error: rejection, isFatal: false },
    ]);
    expect(fake.forwarded).toStrictEqual([{ error: rejection, isFatal: false }]);
  });

  it('buffers reports until the sink connects and keeps only the newest ones', () => {
    const fake = createFakeHooks();
    const net = createErrorNet(fake.hooks, { bufferSize: 2 });
    net.install();
    fake.current()(new Error('first'), false);
    fake.current()(new Error('second'), false);
    fake.current()(new Error('third'), false);
    const sink: ErrorReport[] = [];

    net.connect((report) => sink.push(report));

    expect(sink.map((report) => (report.error as Error).message)).toStrictEqual([
      'second',
      'third',
    ]);
  });

  it('keeps going when the sink throws and logs the sink failure instead', () => {
    const fake = createFakeHooks();
    const net = createErrorNet(fake.hooks, { bufferSize: 10 });
    const sinkFailure = new Error('database is locked');
    net.connect(() => {
      throw sinkFailure;
    });
    net.install();

    expect(() => {
      fake.current()(new Error('boom'), false);
    }).not.toThrow();
    expect(fake.fallback).toStrictEqual([sinkFailure]);
    expect(fake.forwarded).toHaveLength(1);
  });

  it('installs one handler however often install runs and restores the previous one', () => {
    const fake = createFakeHooks();
    const before = fake.current();
    const net = createErrorNet(fake.hooks, { bufferSize: 10 });
    const sink: ErrorReport[] = [];
    net.connect((report) => sink.push(report));

    const uninstall = net.install();
    expect(net.install()).toBe(uninstall);
    fake.current()(new Error('once'), false);
    uninstall();

    expect(sink).toHaveLength(1);
    expect(fake.current()).toBe(before);
    fake.tracker()?.onUnhandled(2, new Error('after uninstall'));
    expect(sink).toHaveLength(1);
  });

  it('replaces, not stacks, the handler of an earlier net (fast refresh re-creates the module)', () => {
    const fake = createFakeHooks();
    const before = fake.current();
    const first: ErrorReport[] = [];
    const second: ErrorReport[] = [];
    const oldNet = createErrorNet(fake.hooks, { bufferSize: 10 });
    oldNet.connect((report) => first.push(report));
    oldNet.install();
    const newNet = createErrorNet(fake.hooks, { bufferSize: 10 });
    newNet.connect((report) => second.push(report));
    const uninstall = newNet.install();

    fake.current()(new Error('after refresh'), false);
    uninstall();

    expect(first).toHaveLength(0);
    expect(second).toHaveLength(1);
    expect(fake.forwarded).toHaveLength(1);
    expect(fake.current()).toBe(before);
  });

  it('accepts reports from an error boundary before and after install', () => {
    const net = createErrorNet(createFakeHooks().hooks, { bufferSize: 10 });
    const renderError = new Error('render failed');
    net.report({ source: 'render', error: renderError, isFatal: false });
    const sink: ErrorReport[] = [];

    net.connect((report) => sink.push(report));

    expect(sink).toStrictEqual([{ source: 'render', error: renderError, isFatal: false }]);
  });
});

describe('readGlobalErrorHooks', () => {
  it('finds ErrorUtils and the Hermes tracker on the global scope', () => {
    const seen: RejectionTrackerOptions[] = [];
    const errorUtils = {
      getGlobalHandler: () => () => undefined,
      setGlobalHandler: () => undefined,
    };
    const hooks = readGlobalErrorHooks({
      ErrorUtils: errorUtils,
      HermesInternal: { enablePromiseRejectionTracker: (options) => seen.push(options) },
    });
    const options = {
      allRejections: true,
      onUnhandled: () => undefined,
      onHandled: () => undefined,
    };

    hooks.enableRejectionTracker?.(options);

    expect(hooks.errorUtils).toBe(errorUtils);
    expect(seen).toStrictEqual([options]);
  });

  it('returns null hooks where the engine has none, and the net still installs', () => {
    const hooks = readGlobalErrorHooks({});

    expect(hooks.errorUtils).toBeNull();
    expect(hooks.enableRejectionTracker).toBeNull();
    expect(() => createErrorNet(hooks, { bufferSize: 1 }).install()).not.toThrow();
  });

  it('logs a sink failure through console.error', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error('sink down');

    readGlobalErrorHooks({}).fallbackLog('error-net: the error sink threw', failure);

    expect(spy).toHaveBeenCalledWith('error-net: the error sink threw', failure);
  });
});
