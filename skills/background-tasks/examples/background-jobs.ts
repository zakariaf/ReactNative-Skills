// src/services/background-tasks/background-jobs.ts
// Example (Tasks app): the template's job list, filled. BackgroundDeps grows by what the jobs need;
// background-environment.ts creates it per run.
import { syncOutboxJob } from './jobs/sync-outbox-job';

import type { BackgroundJob } from './background-job';
import type { SyncOutboxDeps } from './jobs/sync-outbox-job';
import type { ClockPort } from '@/services/clock/clock-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

export type BackgroundDeps = SyncOutboxDeps & {
  readonly clock: Pick<ClockPort, 'nowMs'>;
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
};

export const BACKGROUND_INTERVAL_MINUTES = 12 * 60;

export const BACKGROUND_JOBS: readonly BackgroundJob<BackgroundDeps>[] = [syncOutboxJob];

export function backgroundJobNames(): readonly string[] {
  return BACKGROUND_JOBS.map((job) => job.name);
}
