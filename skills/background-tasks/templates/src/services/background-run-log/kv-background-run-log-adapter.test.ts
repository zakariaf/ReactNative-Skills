// src/services/background-run-log/kv-background-run-log-adapter.test.ts
// The run log on an in-memory stand-in for expo-sqlite/kv-store's synchronous API.
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import {
  RUN_LOG_KEY_PREFIX,
  createKvBackgroundRunLogAdapter,
} from './kv-background-run-log-adapter';

import type { BackgroundRunRecord } from './background-run-log-port';

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

const RECORD: BackgroundRunRecord = {
  name: 'tasks.sync-outbox',
  trigger: 'background',
  startedAtMs: 1_000,
  finishedAtMs: 1_400,
  end: 'partial',
  processed: 20,
  reason: null,
};

describe('createKvBackgroundRunLogAdapter', () => {
  beforeEach(() => {
    mockStore.clear();
    mockState.isFailing = false;
  });

  it('keeps the newest record of each job and trigger under its own key', () => {
    const runLog = createKvBackgroundRunLogAdapter({ errorLog: createFakeErrorLog() });
    const newer: BackgroundRunRecord = {
      ...RECORD,
      startedAtMs: 2_000,
      finishedAtMs: 2_100,
      end: 'done',
      processed: 3,
    };

    runLog.append(RECORD);
    runLog.append(newer);

    expect(runLog.lastRun('tasks.sync-outbox', 'background')).toStrictEqual(newer);
    expect(runLog.lastRun('tasks.sync-outbox', 'foreground')).toBeNull();
    expect([...mockStore.keys()]).toStrictEqual([
      `${RUN_LOG_KEY_PREFIX}background.tasks.sync-outbox`,
    ]);
  });

  it('keeps a foreground run from overwriting the background record', () => {
    const runLog = createKvBackgroundRunLogAdapter({ errorLog: createFakeErrorLog() });
    const foreground: BackgroundRunRecord = {
      ...RECORD,
      trigger: 'foreground',
      startedAtMs: 5_000,
      finishedAtMs: 5_200,
      end: 'done',
      processed: 0,
    };

    runLog.append(RECORD);
    runLog.append(foreground);

    expect([
      runLog.lastRun('tasks.sync-outbox', 'background'),
      runLog.lastRun('tasks.sync-outbox', 'foreground'),
    ]).toStrictEqual([RECORD, foreground]);
  });

  it('answers null for a job that never ran', () => {
    const runLog = createKvBackgroundRunLogAdapter({ errorLog: createFakeErrorLog() });

    expect(runLog.lastRun('tasks.sync-outbox', 'background')).toBeNull();
  });

  it('answers null for a stored record that is not valid JSON or has the wrong shape', () => {
    const runLog = createKvBackgroundRunLogAdapter({ errorLog: createFakeErrorLog() });
    mockStore.set(`${RUN_LOG_KEY_PREFIX}background.a.broken`, '{not json');
    mockStore.set(
      `${RUN_LOG_KEY_PREFIX}background.a.wrong`,
      JSON.stringify({ ...RECORD, end: 'exploded' }),
    );
    mockStore.set(
      `${RUN_LOG_KEY_PREFIX}background.a.untriggered`,
      JSON.stringify({ ...RECORD, trigger: undefined }),
    );

    expect([
      runLog.lastRun('a.broken', 'background'),
      runLog.lastRun('a.wrong', 'background'),
      runLog.lastRun('a.untriggered', 'background'),
    ]).toStrictEqual([null, null, null]);
  });

  it('records a failed write or read in the error log and never throws', () => {
    const errorLog = createFakeErrorLog();
    const runLog = createKvBackgroundRunLogAdapter({ errorLog });
    mockState.isFailing = true;

    runLog.append(RECORD);

    expect(runLog.lastRun('tasks.sync-outbox', 'background')).toBeNull();
    expect(errorLog.recorded.map((entry) => entry.source)).toStrictEqual(['storage', 'storage']);
  });
});
