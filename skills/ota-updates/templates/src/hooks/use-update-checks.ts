// src/hooks/use-update-checks.ts
// The two React seams of the update checker (the ota-updates skill). useUpdateChecks mounts once,
// in the app root after the splash release: it reports an emergency launch and asks for an update
// each time the app returns to the foreground (the checker throttles). useUpdateStatus lets a
// settings row or banner offer "Restart to update" once a download is ready.
import { useEffect, useSyncExternalStore } from 'react';

import { useIsAppActive } from '@/hooks/use-is-app-active';

import type { UpdateChecker, UpdateStatus } from '@/services/updates/update-checker';

/** Starts the checker's foreground checks; renders nothing and returns nothing. */
export function useUpdateChecks(checker: UpdateChecker): void {
  const isActive = useIsAppActive();
  useEffect(() => {
    checker.reportLaunch();
  }, [checker]);
  useEffect(() => {
    if (isActive) checker.checkWhenDue();
  }, [isActive, checker]);
}

/** The checker's status; 'ready' means a downloaded update runs at the next cold start. */
export function useUpdateStatus(checker: UpdateChecker): UpdateStatus {
  return useSyncExternalStore(checker.subscribe, checker.status, checker.status);
}
