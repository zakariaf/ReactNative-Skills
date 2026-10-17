// src/hooks/use-background-registration.ts
// Example (Tasks app): brings the system schedule in line with this build after startup, and again
// when the user flips the "Sync in the background" setting. Never at import time (registering is a
// native call that can fail and must not delay the first frame), never in define-background-tasks.ts.
// The answer feeds the setting row: on a restricted device it says background sync is unavailable.
import { useEffect, useRef, useState } from 'react';

import {
  BACKGROUND_INTERVAL_MINUTES,
  backgroundJobNames,
} from '@/services/background-tasks/background-jobs';
import { reconcileBackgroundTasks } from '@/services/background-tasks/reconcile-background-tasks';

import type {
  BackgroundAvailability,
  BackgroundTasksPort,
} from '@/services/background-tasks/background-tasks-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

export type BackgroundRegistration = 'pending' | BackgroundAvailability | 'failed';

export function useBackgroundRegistration(
  port: BackgroundTasksPort,
  errorLog: Pick<ErrorLogPort, 'record'>,
  isEnabled: boolean,
): BackgroundRegistration {
  const [state, setState] = useState<BackgroundRegistration>('pending');
  // One reconcile at a time: a quick off-and-on would otherwise interleave two runs' port calls, and
  // the 'off' run could unregister after the 'on' run had read the schedule and kept it.
  const queue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let isCurrent = true;
    const run = queue.current.then(() =>
      reconcileBackgroundTasks({
        port,
        jobNames: backgroundJobNames(),
        intervalMinutes: BACKGROUND_INTERVAL_MINUTES,
        isEnabled,
      }),
    );
    queue.current = run.then(
      () => undefined,
      () => undefined,
    );
    run
      .then((result) => {
        if (!isCurrent) return;
        // The adapter already recorded the raw error; the row shows "could not schedule".
        setState(result.ok ? result.value.availability : 'failed');
      })
      .catch((thrown: unknown) => {
        errorLog.record('service', thrown);
      });
    return () => {
      isCurrent = false;
    };
  }, [port, errorLog, isEnabled]);
  return state;
}
