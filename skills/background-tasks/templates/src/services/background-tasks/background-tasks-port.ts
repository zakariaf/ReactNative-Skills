// src/services/background-tasks/background-tasks-port.ts
// Scheduling of the app's background jobs with the operating system (the background-tasks skill owns
// this file). iOS (BGTaskScheduler) and Android (WorkManager) run every job of the app through one
// system worker, so the port schedules job names with one shared interval; when they run is the
// system's choice. Adapter: expo-background-tasks-adapter.ts. Fake: fake-background-tasks.ts.
import type { Result } from '@/core/result';

/**
 * `restricted`: background runs are impossible here (the iOS simulator, Expo Go, web). The app then
 * relies on its foreground path and never claims background sync is on.
 */
export type BackgroundAvailability = 'available' | 'restricted';

/** A job name the system has on its schedule, with the interval it was registered with. */
export type ScheduledBackgroundTask = {
  readonly name: string;
  /** Minutes; null when the registration carries none. */
  readonly intervalMinutes: number | null;
};

/** Expected scheduling failures. The adapter records the raw error before returning one. */
export type BackgroundTasksFailure =
  | { readonly kind: 'background-schedule-unreadable' }
  | { readonly kind: 'background-register-failed'; readonly name: string }
  | { readonly kind: 'background-unregister-failed'; readonly name: string };

/**
 * Schedules job names with the system worker. Every member resolves (expected failures are Result
 * values, an unreadable status is `restricted`); none runs a job.
 */
export type BackgroundTasksPort = {
  /** Never rejects: an unreadable status counts as `restricted`. */
  readonly availability: () => Promise<BackgroundAvailability>;
  /** The background-task registrations of this app (other task types, such as location, are left out). */
  readonly scheduled: () => Promise<
    Result<readonly ScheduledBackgroundTask[], BackgroundTasksFailure>
  >;
  /** Registers `name`; the job must be defined (TaskManager.defineTask) before this is called. */
  readonly register: (
    name: string,
    intervalMinutes: number,
  ) => Promise<Result<void, BackgroundTasksFailure>>;
  readonly unregister: (name: string) => Promise<Result<void, BackgroundTasksFailure>>;
};
