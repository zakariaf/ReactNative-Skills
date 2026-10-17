// src/services/background-tasks/expo-background-tasks-adapter.ts
// BackgroundTasksPort on expo-background-task and expo-task-manager 57: the only app file that
// schedules background work (define-background-tasks.ts is the only one that defines it). Facts read
// in the 57.0.21 source: registerTaskAsync returns without registering when the status is Restricted
// (the iOS simulator) and when the name is already registered, so a new interval needs unregister
// then register; on an iOS device it rejects unless Info.plist has UIBackgroundModes `processing`
// (the expo-background-task config plugin adds it; prebuild does not apply that plugin on its own).
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { attemptAsync, err } from '@/core/result';

import type { Result } from '@/core/result';
import type {
  BackgroundTasksFailure,
  BackgroundTasksPort,
  ScheduledBackgroundTask,
} from '@/services/background-tasks/background-tasks-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

/** The taskType of an expo-background-task registration: iOS consumer, Android consumer (57.0.21). */
const BACKGROUND_TASK_TYPES: ReadonlySet<string> = new Set([
  'backgroundTask',
  'expo-background-task',
]);

export type ExpoBackgroundTasksDeps = {
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
};

type Registration = {
  readonly taskName: string;
  readonly taskType: string;
  readonly options: unknown;
};

function intervalOf(options: unknown): number | null {
  if (typeof options !== 'object' || options === null) return null;
  const value: unknown = Reflect.get(options, 'minimumInterval');
  return typeof value === 'number' ? value : null;
}

function toScheduled(registrations: readonly Registration[]): readonly ScheduledBackgroundTask[] {
  return registrations
    .filter((registration) => BACKGROUND_TASK_TYPES.has(registration.taskType))
    .map((registration) => ({
      name: registration.taskName,
      intervalMinutes: intervalOf(registration.options),
    }));
}

export function createExpoBackgroundTasksAdapter(
  deps: ExpoBackgroundTasksDeps,
): BackgroundTasksPort {
  /** Runs one SDK call; a throw is recorded with the original error and becomes `failure`. */
  async function call<TValue>(
    task: () => Promise<TValue>,
    failure: BackgroundTasksFailure,
  ): Promise<Result<TValue, BackgroundTasksFailure>> {
    const result = await attemptAsync(task, (thrown: unknown) => ({ failure, thrown }));
    if (result.ok) return result;
    deps.errorLog.record('service', result.error.thrown);
    return err(result.error.failure);
  }

  return {
    availability: async () => {
      try {
        const status = await BackgroundTask.getStatusAsync();
        return status === BackgroundTask.BackgroundTaskStatus.Available
          ? 'available'
          : 'restricted';
      } catch (thrown: unknown) {
        deps.errorLog.record('service', thrown);
        return 'restricted';
      }
    },
    scheduled: () =>
      call(() => TaskManager.getRegisteredTasksAsync().then(toScheduled), {
        kind: 'background-schedule-unreadable',
      }),
    register: (name, intervalMinutes) =>
      call(() => BackgroundTask.registerTaskAsync(name, { minimumInterval: intervalMinutes }), {
        kind: 'background-register-failed',
        name,
      }),
    unregister: (name) =>
      call(() => BackgroundTask.unregisterTaskAsync(name), {
        kind: 'background-unregister-failed',
        name,
      }),
  };
}

/**
 * Calls `onExpire` when iOS ends the background window (addExpirationListener, iOS only). In 57.0.21
 * the native side posts the expiry without the `url` its handler requires, so the event may never
 * reach JS (read in BackgroundTaskModule.swift): jobs must not depend on it; it only stops runs early.
 */
export function watchBackgroundExpiry(onExpire: () => void): { readonly remove: () => void } {
  if (Platform.OS !== 'ios') return { remove: () => undefined };
  return BackgroundTask.addExpirationListener(onExpire);
}

/**
 * Debug builds only: asks the system to run the background worker now. iOS: simulates the launch
 * (a physical device; the simulator has no BGTaskScheduler). Android: the worker skips its run
 * while the app is in the foreground (57.0.21 source), so use the adb route of the skill's device
 * proof there. Resolves false in a release build without touching the native module.
 */
export async function triggerBackgroundRunForTesting(): Promise<boolean> {
  if (!__DEV__) return false;
  return BackgroundTask.triggerTaskWorkerForTestingAsync();
}
