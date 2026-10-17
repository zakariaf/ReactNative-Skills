// src/services/background-tasks/reconcile-background-tasks.ts
// Brings the system's schedule in line with the jobs this build defines (the background-tasks skill
// owns this file). Called after startup and whenever the user's background setting changes, never at
// import time. Registrations persist across launches and app updates, so a renamed or removed job
// stays scheduled until something removes it: the runtime then finds no definition and drops it on
// its own only after waking the app for nothing. And because registerTaskAsync keeps an existing
// registration, a changed interval needs unregister then register.
import { ok } from '@/core/result';

import type { Result } from '@/core/result';
import type {
  BackgroundAvailability,
  BackgroundTasksFailure,
  BackgroundTasksPort,
  ScheduledBackgroundTask,
} from '@/services/background-tasks/background-tasks-port';

/** WorkManager's floor; iOS treats any interval as a minimum delay and often runs later. */
export const MIN_INTERVAL_MINUTES = 15;

export type ReconcileRequest = {
  readonly port: BackgroundTasksPort;
  /** Every job this build defines (define-background-tasks.ts), by name. */
  readonly jobNames: readonly string[];
  /** One interval for all jobs: they share one system worker, and the last registration sets it. */
  readonly intervalMinutes: number;
  /** The user's choice (a setting) and any precondition the app adds (signed in). */
  readonly isEnabled: boolean;
};

export type ReconcileReport = {
  readonly availability: BackgroundAvailability;
  /** Names on the schedule afterwards, sorted. */
  readonly scheduled: readonly string[];
  /** Names this call removed (no longer defined, or disabled), sorted. */
  readonly removed: readonly string[];
};

type Plan = { readonly unregister: readonly string[]; readonly register: readonly string[] };

function planFor(current: readonly ScheduledBackgroundTask[], request: ReconcileRequest): Plan {
  const wanted = new Set(request.isEnabled ? request.jobNames : []);
  const keep = new Set(
    current
      .filter((task) => wanted.has(task.name) && task.intervalMinutes === request.intervalMinutes)
      .map((task) => task.name),
  );
  return {
    unregister: current.map((task) => task.name).filter((name) => !keep.has(name)),
    register: [...wanted].filter((name) => !keep.has(name)),
  };
}

async function apply(
  port: BackgroundTasksPort,
  plan: Plan,
  intervalMinutes: number,
): Promise<Result<void, BackgroundTasksFailure>> {
  for (const name of plan.unregister) {
    const removed = await port.unregister(name);
    if (!removed.ok) return removed;
  }
  for (const name of plan.register) {
    const added = await port.register(name, intervalMinutes);
    if (!added.ok) return added;
  }
  return ok(undefined);
}

/**
 * Unregisters what this build no longer wants (or wants with another interval), then registers what
 * is missing. On a restricted device it changes nothing and says so. Stops at the first failure.
 */
export async function reconcileBackgroundTasks(
  request: ReconcileRequest,
): Promise<Result<ReconcileReport, BackgroundTasksFailure>> {
  if (
    !Number.isInteger(request.intervalMinutes) ||
    request.intervalMinutes < MIN_INTERVAL_MINUTES
  ) {
    throw new Error(
      `background interval must be a whole number of minutes >= ${String(MIN_INTERVAL_MINUTES)}`,
    );
  }
  const availability = await request.port.availability();
  if (availability === 'restricted') return ok({ availability, scheduled: [], removed: [] });
  const current = await request.port.scheduled();
  if (!current.ok) return current;
  const plan = planFor(current.value, request);
  const applied = await apply(request.port, plan, request.intervalMinutes);
  if (!applied.ok) return applied;
  const wanted = new Set(request.isEnabled ? request.jobNames : []);
  return ok({
    availability,
    scheduled: [...wanted].sort(),
    removed: plan.unregister.filter((name) => !wanted.has(name)).sort(),
  });
}
