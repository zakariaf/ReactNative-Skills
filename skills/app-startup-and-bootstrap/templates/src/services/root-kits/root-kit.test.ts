// src/services/root-kits/root-kit.test.ts
import { ok } from '@/core/result';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import {
  createKitErrorSink,
  kitBlocking,
  kitFlushers,
  kitMotion,
  kitsOpenDebugRoutes,
} from './root-kit';

import type { RootKit } from './root-kit';
import type { ErrorReport } from '@/services/error-net/error-net';

const renderError: ErrorReport = { source: 'render', error: new Error('render'), isFatal: false };
const rejection: ErrorReport = {
  source: 'unhandled-rejection',
  error: new Error('rejected'),
  isFatal: false,
};

function recordingKit(name: string, into: string[]): RootKit {
  return {
    name,
    forward: (report) => {
      into.push(`${name}:${report.source}`);
    },
  };
}

describe('createKitErrorSink', () => {
  it('records every report in the error log, with or without kits', () => {
    const errorLog = createFakeErrorLog();
    const errors = createKitErrorSink(errorLog);
    errors.sink(renderError);
    errors.attach([]);
    errors.sink(rejection);
    expect(errorLog.recorded.map((entry) => entry.source)).toStrictEqual([
      'render',
      'unhandled-rejection',
    ]);
  });

  it('replays the reports caught before the kits existed, then forwards new ones', () => {
    const forwarded: string[] = [];
    const errors = createKitErrorSink(createFakeErrorLog());
    errors.sink(renderError);
    errors.attach([recordingKit('crash', forwarded), { name: 'quiet' }]);
    expect(forwarded).toStrictEqual(['crash:render']);
    errors.sink(rejection);
    expect(forwarded).toStrictEqual(['crash:render', 'crash:unhandled-rejection']);
  });

  it('keeps only the newest reports before the kits attach', () => {
    const forwarded: string[] = [];
    const errors = createKitErrorSink(createFakeErrorLog(), { replayLimit: 1 });
    errors.sink(renderError);
    errors.sink(rejection);
    errors.attach([recordingKit('crash', forwarded)]);
    expect(forwarded).toStrictEqual(['crash:unhandled-rejection']);
  });

  it('attaches once: a second list is ignored', () => {
    const first: string[] = [];
    const second: string[] = [];
    const errors = createKitErrorSink(createFakeErrorLog());
    errors.attach([recordingKit('a', first)]);
    errors.attach([recordingKit('b', second)]);
    errors.sink(renderError);
    expect(first).toStrictEqual(['a:render']);
    expect(second).toStrictEqual([]);
  });

  it('records a kit that throws, and the next kit still receives the report', () => {
    const errorLog = createFakeErrorLog();
    const forwarded: string[] = [];
    const errors = createKitErrorSink(errorLog);
    const broken: RootKit = {
      name: 'broken',
      forward: () => {
        throw new Error('boom');
      },
    };
    errors.attach([broken, recordingKit('crash', forwarded)]);
    errors.sink(renderError);
    expect(forwarded).toStrictEqual(['crash:render']);
    expect(errorLog.entries()[0]?.message).toBe(
      'root kit broken failed to forward an error report',
    );
  });

  it('records kits that share a name', () => {
    const errorLog = createFakeErrorLog();
    createKitErrorSink(errorLog).attach([{ name: 'push' }, { name: 'push' }]);
    expect(errorLog.recorded.map((entry) => entry.source)).toStrictEqual(['startup']);
    expect(errorLog.entries()[0]?.message).toBe('root kits share a name: push');
  });
});

describe('kitBlocking and kitFlushers', () => {
  it('collects every kit part in registry order and skips kits without one', () => {
    const run = (): Promise<ReturnType<typeof ok>> => Promise.resolve(ok(undefined));
    const flush = (): void => undefined;
    const kits: readonly RootKit[] = [
      { name: 'a', blocking: [{ name: 'a-task', run }], flushers: [{ name: 'a-queue', flush }] },
      { name: 'b' },
      { name: 'c', blocking: [{ name: 'c-task', run }], flushers: [{ name: 'c-queue', flush }] },
    ];
    expect(kitBlocking(kits).map((task) => task.name)).toStrictEqual(['a-task', 'c-task']);
    expect(kitFlushers(kits).map((flusher) => flusher.name)).toStrictEqual(['a-queue', 'c-queue']);
  });

  it('returns nothing without kits', () => {
    expect(kitBlocking([])).toStrictEqual([]);
    expect(kitFlushers([])).toStrictEqual([]);
  });
});

describe('kitMotion and kitsOpenDebugRoutes', () => {
  it('picks the first kit that renders the motion config', () => {
    const first = (): null => null;
    const second = (): null => null;
    const kits: readonly RootKit[] = [
      { name: 'a' },
      { name: 'b', motion: first },
      { name: 'c', motion: second },
    ];
    expect(kitMotion(kits)).toBe(first);
  });

  it('leaves the plain motion config and the closed debug group without such a kit', () => {
    const kits: readonly RootKit[] = [{ name: 'a' }, { name: 'b', opensDebugRoutes: false }];
    expect(kitMotion(kits)).toBeNull();
    expect(kitsOpenDebugRoutes(kits)).toBe(false);
    expect(kitsOpenDebugRoutes([])).toBe(false);
  });

  it('opens the debug group when a kit says so', () => {
    expect(kitsOpenDebugRoutes([{ name: 'a' }, { name: 'debug', opensDebugRoutes: true }])).toBe(
      true,
    );
  });
});
