// src/services/crash-reporter/crash-reporter-port.ts
// The app's view of crash reporting (owned by the crash-reporting-and-observability skill). One
// adapter talks to the SDK (sentry-crash-reporter-adapter.ts); tests use fake-crash-reporter.ts.
// Nothing here names the vendor, so a feature never learns which service receives its reports.
import type { ErrorSource } from '@/services/error-log/error-log-port';

/** Where the reporter is: waiting for the person's choice, sending, or off for this run. */
export type CrashReporterStatus = 'waiting' | 'reporting' | 'off';

/** How a defect was caught, so the report can be filtered by boundary. */
export type CrashReportContext = {
  readonly source: ErrorSource;
  readonly isFatal: boolean;
};

/** App breadcrumb kinds; the adapter sends them as `app.<category>`. */
export type BreadcrumbCategory = 'navigation' | 'lifecycle' | 'action' | 'storage' | 'network';

/**
 * One step before a crash. The message is a route pattern or a fixed event name, never text the
 * person typed; data holds flat primitives (ids of rows are not allowed either: they are content).
 */
export type CrashBreadcrumb = {
  readonly category: BreadcrumbCategory;
  readonly message: string;
  readonly data?: Readonly<Record<string, string | number | boolean>>;
};

/**
 * Crash reporting behind a port. No member throws or rejects: a reporter that fails must never
 * take the app down with it. There is deliberately no setUser: reports are not linked to a person.
 */
export type CrashReporterPort = {
  /**
   * Applies the person's choice. true starts the SDK once (never before this call) and sends what
   * waited; false stops sending and drops what waited. Call it after the first screen is drawn.
   */
  readonly setConsent: (isGranted: boolean) => void;
  /** Reports a defect (never an expected failure: those travel as Result values). */
  readonly captureException: (error: unknown, context: CrashReportContext) => void;
  readonly addBreadcrumb: (breadcrumb: CrashBreadcrumb) => void;
  /** Writes queued reports to disk before an OTA reload; resolves false when nothing could. */
  readonly flush: () => Promise<boolean>;
  readonly status: () => CrashReporterStatus;
};
