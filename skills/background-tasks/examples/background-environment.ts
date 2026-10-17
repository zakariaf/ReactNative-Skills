// src/services/background-tasks/background-environment.ts
// device-only: covered by the background run on a device (background-tasks device proof: the run log shows the run)
// Example (Tasks app): the template's environment with the outbox and the change sender. The database
// comes from the data layer's background open path (src/data/open-background-data.ts): it opens only
// at the current schema and hands back repositories and a close function, never the driver, so this
// file runs no SQL (persistence-and-migrations). Behind schema, `outbox` is null and the job defers
// until the next foreground start migrates. The connection is opened for this run only, so `dispose`
// closes it; toTaskExecutor calls it once the run ended, also after a crash or a timeout, so a warm
// process (an iOS resume, a live Android process) never piles them up.
// The error log is durable either way: the SQLite one over this connection when the database is
// current (the app's error_log table), else the background error log on kv-store. Both outlive the
// process, so the debug screen shows what a crashed run threw.
import { createDeviceApiClient } from '@/api/create-device-api-client';
import { createApiChangeSender } from '@/api/sync/api-change-sender';
import { openBackgroundData } from '@/data/open-background-data';
import { createKvBackgroundErrorLogAdapter } from '@/services/background-run-log/kv-background-error-log-adapter';
import { createKvBackgroundRunLogAdapter } from '@/services/background-run-log/kv-background-run-log-adapter';
import { createSystemClockAdapter } from '@/services/clock/system-clock-adapter';
import { createMemoryErrorLogAdapter } from '@/services/error-log/memory-error-log-adapter';

import type { JobEnvironment } from './background-job';
import type { BackgroundDeps } from './background-jobs';

export function createBackgroundEnvironment(): JobEnvironment<BackgroundDeps> {
  const clock = createSystemClockAdapter();
  const kvErrorLog = createKvBackgroundErrorLogAdapter({
    clock,
    fallback: createMemoryErrorLogAdapter({ clock }),
  });
  const data = openBackgroundData({ clock, fallback: kvErrorLog });
  const errorLog = data?.errorLog ?? kvErrorLog;
  return {
    deps: {
      clock,
      errorLog,
      outbox: data?.outbox ?? null,
      sender: createApiChangeSender(createDeviceApiClient()),
    },
    clock,
    errorLog,
    runLog: createKvBackgroundRunLogAdapter({ errorLog }),
    dispose: () => {
      data?.close();
    },
  };
}
