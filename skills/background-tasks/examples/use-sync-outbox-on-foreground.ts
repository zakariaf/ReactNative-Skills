// src/hooks/use-sync-outbox-on-foreground.ts
// Example (Tasks app): the foreground path of the outbox job. Background runs are an optimisation the
// system may never grant (a restricted device, Low Power Mode, a user who force-quit the app on iOS),
// so the same job also runs each time the app becomes active, through the same runner: one run at a
// time per job, the same budget, the same run log. A background run still going when the user opens
// the app makes this call answer `overlapping` instead of sending twice. These runs are recorded under
// the `foreground` trigger: they never count as proof that the system ran the background task.
import { useEffect } from 'react';

import { useIsAppActive } from '@/hooks/use-is-app-active';
import { runBackgroundJob } from '@/services/background-tasks/background-job';
import { syncOutboxJob } from '@/services/background-tasks/jobs/sync-outbox-job';

import type { JobEnvironment } from '@/services/background-tasks/background-job';
import type { BackgroundDeps } from '@/services/background-tasks/background-jobs';

/**
 * `environment` comes from the app's composition root (the same ports the screens use, plus the
 * run log), never from createBackgroundEnvironment(): in the foreground the app database is open.
 */
export function useSyncOutboxOnForeground(environment: JobEnvironment<BackgroundDeps>): void {
  const isActive = useIsAppActive();
  useEffect(() => {
    if (!isActive) return;
    // The run log and the error log hold the outcome; the runner never rejects, the catch is the net.
    runBackgroundJob(syncOutboxJob, environment, { trigger: 'foreground' }).catch(
      (thrown: unknown) => {
        environment.errorLog.record('service', thrown);
      },
    );
  }, [isActive, environment]);
}
