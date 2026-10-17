// src/services/background-run-log/kv-background-error-log-adapter.test.ts
// The background error log on an in-memory stand-in for expo-sqlite/kv-store's synchronous API. A new
// adapter instance over the same store plays the foreground process reading what a background run
// left behind.
import { defineBackgroundJob } from '@/services/background-tasks/background-job';
import { toTaskExecutor } from '@/services/background-tasks/task-executor';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { createFakeBackgroundRunLog } from './fake-background-run-log';
import {
  BACKGROUND_ERROR_LOG_KEY,
  createKvBackgroundErrorLogAdapter,
} from './kv-background-error-log-adapter';

const mockStore = new Map<string, string>();
const mockState = { isFailing: false };

jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItemSync: (key: string) => {
      if (mockState.isFailing) throw new Error('disk I/O error');
      return mockStore.get(key) ?? null;
    },
    setItemSync: (key: string, value: string) => {
      if (mockState.isFailing) throw new Error('database or disk is full');
      mockStore.set(key, value);
    },
  },
}));

function clockAt(start: number): { readonly nowMs: () => number } {
  let now = start;
  return {
    nowMs: () => {
      now += 1;
      return now;
    },
  };
}

describe('createKvBackgroundErrorLogAdapter', () => {
  beforeEach(() => {
    mockStore.clear();
    mockState.isFailing = false;
  });

  it('keeps entries newest first, readable by another adapter instance', () => {
    const background = createKvBackgroundErrorLogAdapter({
      clock: clockAt(1_000),
      fallback: createFakeErrorLog(),
    });

    background.record('service', new Error('first'));
    background.record('network', 'second');
    const foreground = createKvBackgroundErrorLogAdapter({
      clock: clockAt(9_000),
      fallback: createFakeErrorLog(),
    });

    expect(foreground.entries()).toStrictEqual([
      { atMs: 1_002, source: 'network', message: 'second' },
      { atMs: 1_001, source: 'service', message: 'first' },
    ]);
  });

  it('drops the oldest entries beyond the limit', () => {
    const log = createKvBackgroundErrorLogAdapter({
      clock: clockAt(0),
      fallback: createFakeErrorLog(),
      limit: 2,
    });

    log.record('service', 'a');
    log.record('service', 'b');
    log.record('service', 'c');

    expect(log.entries().map((entry) => entry.message)).toStrictEqual(['c', 'b']);
  });

  it('reads a malformed stored value as no entries and skips entries of the wrong shape', () => {
    const log = createKvBackgroundErrorLogAdapter({
      clock: clockAt(0),
      fallback: createFakeErrorLog(),
    });
    mockStore.set(BACKGROUND_ERROR_LOG_KEY, '{not json');
    const first = log.entries();
    mockStore.set(
      BACKGROUND_ERROR_LOG_KEY,
      JSON.stringify([
        { atMs: 5, source: 'exploded', message: 'unknown source' },
        { atMs: 4, source: 'storage', message: 'kept' },
      ]),
    );

    expect([first, log.entries()]).toStrictEqual([
      [],
      [{ atMs: 4, source: 'storage', message: 'kept' }],
    ]);
  });

  it('hands what storage refuses to the fallback and never throws', () => {
    const fallback = createFakeErrorLog();
    const log = createKvBackgroundErrorLogAdapter({ clock: clockAt(0), fallback });
    mockState.isFailing = true;

    log.record('service', new Error('job threw'));
    const entries = log.entries();

    expect(fallback.recorded.map((entry) => entry.source)).toStrictEqual(['service', 'storage']);
    expect(entries[0]?.message).toBe('background error log unreadable: disk I/O error');
  });

  it('keeps what a crashed background run threw for the foreground to read', async () => {
    const clock = clockAt(0);
    const job = defineBackgroundJob<Record<string, never>>({
      name: 'tasks.example',
      budgetMs: 1_000,
      run: () => Promise.reject(new TypeError('row.id is undefined')),
    });
    const executor = toTaskExecutor(job, () => ({
      deps: {},
      clock,
      errorLog: createKvBackgroundErrorLogAdapter({ clock, fallback: createFakeErrorLog() }),
      runLog: createFakeBackgroundRunLog(),
    }));

    await executor({ data: undefined, error: null });
    const foreground = createKvBackgroundErrorLogAdapter({
      clock,
      fallback: createFakeErrorLog(),
    });

    expect(foreground.entries().map(({ source, message }) => ({ source, message }))).toStrictEqual([
      { source: 'service', message: 'background job tasks.example threw: row.id is undefined' },
    ]);
  });
});
