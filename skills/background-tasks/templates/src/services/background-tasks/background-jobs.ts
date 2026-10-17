// src/services/background-tasks/background-jobs.ts
// The app's background jobs and their shared interval: the one list define-background-tasks.ts
// defines and the startup reconciles (the background-tasks skill ships this file; the app fills it).
// Add a job here after its own test proves it idempotent and stoppable (job-test-kit).
import type { BackgroundJob } from './background-job';
import type { ClockPort } from '@/services/clock/clock-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

/**
 * What jobs receive. Ports and repositories only: a background run may render no screen at all
 * (Android's headless loader), so nothing here may come from React context or a store. Add a
 * member per dependency a job needs and create it in background-environment.ts.
 */
export type BackgroundDeps = {
  readonly clock: Pick<ClockPort, 'nowMs'>;
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
};

/**
 * Passed explicitly on both platforms: the SDK defaults differ (12 h on iOS, 24 h on Android in the
 * 57.0.21 native code). The system treats it as a minimum delay; 15 is the floor.
 */
export const BACKGROUND_INTERVAL_MINUTES = 12 * 60;

/** Every job of this build. Removing or renaming one is safe: the startup reconcile unregisters it. */
export const BACKGROUND_JOBS: readonly BackgroundJob<BackgroundDeps>[] = [];

/** The names the startup reconcile schedules. */
export function backgroundJobNames(): readonly string[] {
  return BACKGROUND_JOBS.map((job) => job.name);
}
