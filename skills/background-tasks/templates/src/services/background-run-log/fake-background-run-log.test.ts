// src/services/background-run-log/fake-background-run-log.test.ts
import { createFakeBackgroundRunLog } from './fake-background-run-log';

import type { BackgroundRunRecord } from './background-run-log-port';

const FIRST: BackgroundRunRecord = {
  name: 'tasks.sync-outbox',
  trigger: 'background',
  startedAtMs: 10,
  finishedAtMs: 20,
  end: 'done',
  processed: 1,
  reason: null,
};

describe('createFakeBackgroundRunLog', () => {
  it('keeps every record in order and answers the newest per job and trigger', () => {
    const runLog = createFakeBackgroundRunLog();
    const second: BackgroundRunRecord = {
      ...FIRST,
      startedAtMs: 30,
      finishedAtMs: 31,
      end: 'overlapping',
      processed: null,
    };
    const foreground: BackgroundRunRecord = { ...FIRST, trigger: 'foreground', startedAtMs: 40 };

    runLog.append(FIRST);
    runLog.append(second);
    runLog.append(foreground);

    expect(runLog.records()).toStrictEqual([FIRST, second, foreground]);
    expect(runLog.lastRun('tasks.sync-outbox', 'background')).toStrictEqual(second);
    expect(runLog.lastRun('tasks.sync-outbox', 'foreground')).toStrictEqual(foreground);
    expect(runLog.lastRun('tasks.other', 'background')).toBeNull();
  });
});
