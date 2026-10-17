// src/services/error-log/error-log-port.ts

/** Where an error was caught. Extend the union when a new boundary records errors. */
export type ErrorSource =
  | 'render'
  | 'global-handler'
  | 'unhandled-rejection'
  | 'startup'
  | 'storage'
  | 'network'
  | 'service'
  | 'i18n';

export type ErrorLogEntry = {
  readonly atMs: number;
  readonly source: ErrorSource;
  readonly message: string;
};

/**
 * The app's local error log: the last errors the boundaries caught, for a support screen or a
 * debug export. It never leaves the device by itself (crash reporting is a separate port).
 * `record` never throws and never rejects. Adapters: memory-error-log-adapter.ts (this session),
 * a persistent one from the storage layer. Fake: fake-error-log.ts.
 */
export type ErrorLogPort = {
  readonly record: (source: ErrorSource, error: unknown) => void;
  /** Newest first. */
  readonly entries: () => readonly ErrorLogEntry[];
};
