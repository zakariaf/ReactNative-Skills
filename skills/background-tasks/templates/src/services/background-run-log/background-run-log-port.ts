// src/services/background-run-log/background-run-log-port.ts
// The durable record of the last run of each job, per trigger (the background-tasks skill owns this
// file). Background work runs with no screen and no console anyone reads: on a phone, this record is
// the only answer to "did the job run, when, and how did it end". A debug screen or a support export
// reads it. Background and foreground runs are kept apart, because the foreground path runs the same
// job each time the app becomes active: opening the app to read the log would otherwise overwrite the
// background record it was meant to prove. Adapters: kv-background-run-log-adapter.ts (the app).
// Fake: fake-background-run-log.ts.

/**
 * How a run ended. The first four are the job's own outcome; the runner adds the rest:
 * `timed-out` (the budget ran out), `cancelled` (the system ended the window), `crashed` (the job
 * threw: a bug, recorded in the error log) and `overlapping` (a run of the same job was still going).
 */
export type RunEnd =
  | 'done'
  | 'partial'
  | 'deferred'
  | 'failed'
  | 'timed-out'
  | 'cancelled'
  | 'crashed'
  | 'overlapping';

/**
 * Who started the run: `background` is the system's task executor (toTaskExecutor: a periodic
 * expo-background-task run, a notification or location task); `foreground` is the app itself (app
 * active, after a write, pull to refresh). Only a `background` record proves the system ran the task.
 */
export type RunTrigger = 'background' | 'foreground';

export type BackgroundRunRecord = {
  /** The job's name, `<area>.<job>` (tasks.sync-outbox). */
  readonly name: string;
  readonly trigger: RunTrigger;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly end: RunEnd;
  /** Items the job finished in this run (done, partial); null for the other ends. */
  readonly processed: number | null;
  /** A kebab-case reason id (deferred, failed); never user data or an error message. */
  readonly reason: string | null;
};

/** `append` never throws: a failed write is recorded in the error log by the adapter. */
export type BackgroundRunLogPort = {
  readonly append: (record: BackgroundRunRecord) => void;
  /**
   * The newest record of `name` started by `trigger`, or null when no such run happened (or the
   * stored record is unreadable). The device proof reads `lastRun(name, 'background')`.
   */
  readonly lastRun: (name: string, trigger: RunTrigger) => BackgroundRunRecord | null;
};
