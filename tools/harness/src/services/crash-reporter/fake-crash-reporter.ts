// src/services/crash-reporter/fake-crash-reporter.ts
// An in-memory CrashReporterPort for tests: it records every call and follows the adapter's
// consent rules (nothing counts as sent before setConsent(true); at most FAKE_PENDING_LIMIT items
// wait, oldest dropped; false drops what waited; a refusal after reporting started keeps it off for
// the rest of the run), so a test can prove what would have left the device.
import type {
  CrashBreadcrumb,
  CrashReportContext,
  CrashReporterPort,
  CrashReporterStatus,
} from './crash-reporter-port';

export type CapturedReport = {
  readonly error: unknown;
  readonly context: CrashReportContext;
};

export type FakeCrashReporter = CrashReporterPort & {
  /** Reports that would have been sent, oldest first. */
  readonly sent: readonly CapturedReport[];
  /** Breadcrumbs that would have been sent, oldest first. */
  readonly breadcrumbs: readonly CrashBreadcrumb[];
  /** Every setConsent call, in order. */
  readonly consents: readonly boolean[];
};

/** The adapter's PENDING_LIMIT (its test asserts the two agree; the fake never imports the SDK). */
export const FAKE_PENDING_LIMIT = 30;

type Pending =
  | { readonly kind: 'report'; readonly report: CapturedReport }
  | { readonly kind: 'breadcrumb'; readonly breadcrumb: CrashBreadcrumb };

type ConsentQueue = {
  readonly accept: (item: Pending) => void;
  readonly setConsent: (isGranted: boolean) => void;
  readonly status: () => CrashReporterStatus;
};

/** The adapter's consent rules, without the SDK: `deliver` stands for "sent". */
function createConsentQueue(isConfigured: boolean, deliver: (item: Pending) => void): ConsentQueue {
  let pending: Pending[] = [];
  let current: CrashReporterStatus = isConfigured ? 'waiting' : 'off';
  // Like the adapter: a refusal while reporting closes the SDK until the next launch.
  let isClosed = false;
  return {
    accept: (item) => {
      if (current === 'reporting') deliver(item);
      else if (current === 'waiting') pending = [...pending, item].slice(-FAKE_PENDING_LIMIT);
    },
    setConsent: (isGranted) => {
      if (!isConfigured || isClosed || (isGranted && current === 'reporting')) return;
      const waiting = pending;
      pending = [];
      if (!isGranted) {
        if (current === 'reporting') isClosed = true;
        current = 'off';
        return;
      }
      current = 'reporting';
      waiting.forEach(deliver);
    },
    status: () => current,
  };
}

/** A fake reporter; `isConfigured: false` behaves like a build without a DSN (always off). */
export function createFakeCrashReporter(
  options: { readonly isConfigured?: boolean } = {},
): FakeCrashReporter {
  const sent: CapturedReport[] = [];
  const breadcrumbs: CrashBreadcrumb[] = [];
  const consents: boolean[] = [];
  const queue = createConsentQueue(options.isConfigured ?? true, (item) => {
    if (item.kind === 'report') sent.push(item.report);
    else breadcrumbs.push(item.breadcrumb);
  });
  return {
    sent,
    breadcrumbs,
    consents,
    setConsent: (isGranted) => {
      consents.push(isGranted);
      queue.setConsent(isGranted);
    },
    captureException: (error, context) => {
      queue.accept({ kind: 'report', report: { error, context } });
    },
    addBreadcrumb: (breadcrumb) => {
      queue.accept({ kind: 'breadcrumb', breadcrumb });
    },
    flush: () => Promise.resolve(queue.status() === 'reporting'),
    status: queue.status,
  };
}
