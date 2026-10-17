// src/hooks/use-sync-outbox-on-foreground.test.ts
// no-providers: the hook takes its environment as an argument; useIsAppActive is replaced below.
// Example (Tasks app): the foreground path runs the outbox job each time the app becomes active,
// through the same runner, recorded as `foreground`, and never alongside a run still going.
import { renderHook, waitFor } from '@testing-library/react-native';

import { ok } from '@/core/result';
import { createFakeBackgroundRunLog } from '@/services/background-run-log/fake-background-run-log';
import { runBackgroundJob } from '@/services/background-tasks/background-job';
import { syncOutboxJob } from '@/services/background-tasks/jobs/sync-outbox-job';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { useSyncOutboxOnForeground } from './use-sync-outbox-on-foreground';

import type { JobEnvironment } from '@/services/background-tasks/background-job';
import type { BackgroundDeps } from '@/services/background-tasks/background-jobs';
import type { OutboxChange } from '@/services/background-tasks/jobs/sync-outbox-job';

const mockApp = { isActive: true };
jest.mock('@/hooks/use-is-app-active', () => ({
  useIsAppActive: () => mockApp.isActive,
}));

type Setup = {
  readonly environment: JobEnvironment<BackgroundDeps>;
  readonly runLog: ReturnType<typeof createFakeBackgroundRunLog>;
  /** Resolves the server's answer to the request in flight, if any. */
  readonly answer: () => void;
};

/** One pending change whose request stays open until `answer()`, so a run can be caught mid-way. */
function setup(): Setup {
  const pending = new Map<string, OutboxChange>([['c1', { id: 'c1', payload: {} }]]);
  const waiting: (() => void)[] = [];
  const runLog = createFakeBackgroundRunLog();
  const errorLog = createFakeErrorLog();
  const environment: JobEnvironment<BackgroundDeps> = {
    deps: {
      clock: { nowMs: () => 0 },
      errorLog,
      outbox: {
        pendingChanges: (limit) => ok([...pending.values()].slice(0, limit)),
        markSynced: (id) => {
          pending.delete(id);
          return ok(undefined);
        },
        markRejected: (id) => {
          pending.delete(id);
          return ok(undefined);
        },
      },
      sender: {
        send: () =>
          new Promise((resolve) => {
            waiting.push(() => {
              resolve(ok(undefined));
            });
          }),
      },
    },
    clock: { nowMs: () => 0 },
    errorLog,
    runLog,
  };
  const answer = (): void => {
    waiting.shift()?.();
  };
  return { environment, runLog, answer };
}

const ends = (runLog: Setup['runLog']): string[] =>
  runLog.records().map((record) => `${record.trigger} ${record.end}`);

describe('useSyncOutboxOnForeground', () => {
  beforeEach(() => {
    mockApp.isActive = true;
  });

  it('runs the job as a foreground run when the app is active', async () => {
    const app = setup();
    await renderHook(() => {
      useSyncOutboxOnForeground(app.environment);
    });

    app.answer();

    await waitFor(() => {
      expect(ends(app.runLog)).toStrictEqual(['foreground done']);
    });
  });

  it('runs nothing while the app is in the background, and runs again when it comes back', async () => {
    mockApp.isActive = false;
    const app = setup();
    const view = await renderHook(() => {
      useSyncOutboxOnForeground(app.environment);
    });
    expect(ends(app.runLog)).toStrictEqual([]);

    mockApp.isActive = true;
    await view.rerender({});
    app.answer();

    await waitFor(() => {
      expect(ends(app.runLog)).toStrictEqual(['foreground done']);
    });
  });

  it('answers overlapping instead of sending twice while a background run is going on', async () => {
    mockApp.isActive = false;
    const app = setup();
    const background = runBackgroundJob(syncOutboxJob, app.environment, { trigger: 'background' });
    const view = await renderHook(() => {
      useSyncOutboxOnForeground(app.environment);
    });

    mockApp.isActive = true;
    await view.rerender({});
    await waitFor(() => {
      expect(ends(app.runLog)).toStrictEqual(['foreground overlapping']);
    });
    app.answer();
    await background;

    expect(ends(app.runLog)).toStrictEqual(['foreground overlapping', 'background done']);
  });
});
