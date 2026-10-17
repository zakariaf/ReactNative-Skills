// src/services/background-tasks/fake-background-tasks.ts
// Jest only: an in-memory BackgroundTasksPort. The schedule is a map the test reads; availability
// and failing operations are set per test.
import { err, ok } from '@/core/result';

import type {
  BackgroundAvailability,
  BackgroundTasksPort,
  ScheduledBackgroundTask,
} from './background-tasks-port';

export type FakeBackgroundTasksOptions = {
  readonly availability?: BackgroundAvailability;
  /** Registrations present before the test starts (left over from an older app version). */
  readonly scheduled?: readonly ScheduledBackgroundTask[];
  /** Names whose register call fails. */
  readonly failingNames?: readonly string[];
};

export type FakeBackgroundTasks = BackgroundTasksPort & {
  /** The schedule now, sorted by name. */
  readonly schedule: () => readonly ScheduledBackgroundTask[];
  /** Every register and unregister call, in order: ['register tasks.a 720', 'unregister tasks.b']. */
  readonly calls: () => readonly string[];
};

export function createFakeBackgroundTasks(
  options: FakeBackgroundTasksOptions = {},
): FakeBackgroundTasks {
  const schedule = new Map((options.scheduled ?? []).map((task) => [task.name, task]));
  const failing = new Set(options.failingNames ?? []);
  const calls: string[] = [];
  return {
    availability: () => Promise.resolve(options.availability ?? 'available'),
    scheduled: () => Promise.resolve(ok([...schedule.values()])),
    register: (name, intervalMinutes) => {
      calls.push(`register ${name} ${String(intervalMinutes)}`);
      if (failing.has(name))
        return Promise.resolve(err({ kind: 'background-register-failed', name }));
      // Like the SDK: a name already scheduled keeps its first registration.
      if (!schedule.has(name)) schedule.set(name, { name, intervalMinutes });
      return Promise.resolve(ok(undefined));
    },
    unregister: (name) => {
      calls.push(`unregister ${name}`);
      schedule.delete(name);
      return Promise.resolve(ok(undefined));
    },
    schedule: () => [...schedule.values()].sort((a, b) => a.name.localeCompare(b.name)),
    calls: () => [...calls],
  };
}
