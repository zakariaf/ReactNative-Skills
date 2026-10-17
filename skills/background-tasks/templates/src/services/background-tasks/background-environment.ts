// src/services/background-tasks/background-environment.ts
// device-only: covered by the background run on a device (background-tasks device proof: the run log shows the run)
// The composition root of a background run: creates what jobs need, per run, inside the task
// executor. On Android a run in a stopped process renders no root layout (headless loader), so the
// app's own composition root may never have run. A job that needs the app database gets it from the
// data layer only when the file is already at the current schema; a background run never migrates
// (the background-tasks skill, rule 8, and its examples/open-background-data.ts).
import { createKvBackgroundErrorLogAdapter } from '@/services/background-run-log/kv-background-error-log-adapter';
import { createKvBackgroundRunLogAdapter } from '@/services/background-run-log/kv-background-run-log-adapter';
import { createSystemClockAdapter } from '@/services/clock/system-clock-adapter';
import { createMemoryErrorLogAdapter } from '@/services/error-log/memory-error-log-adapter';

import type { JobEnvironment } from './background-job';
import type { BackgroundDeps } from './background-jobs';

/**
 * A fresh environment for one run: the system clock, the durable background error log (a crash's
 * cause outlives the process, so the debug screen can show it), the durable run log. Nothing here
 * needs releasing; an environment that opens a connection for the run closes it in `dispose`, which
 * toTaskExecutor calls once the run ended (examples/background-environment.ts).
 */
export function createBackgroundEnvironment(): JobEnvironment<BackgroundDeps> {
  const clock = createSystemClockAdapter();
  const errorLog = createKvBackgroundErrorLogAdapter({
    clock,
    fallback: createMemoryErrorLogAdapter({ clock }),
  });
  return {
    deps: { clock, errorLog },
    clock,
    errorLog,
    runLog: createKvBackgroundRunLogAdapter({ errorLog }),
  };
}
