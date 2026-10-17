// src/services/error-log/error-log-port.ts
export type ErrorSource = 'render' | 'unhandled-rejection' | 'service';

/** Records an error on the device; `record` never throws and never rejects. */
export type ErrorLogPort = { readonly record: (source: ErrorSource, error: unknown) => void };
