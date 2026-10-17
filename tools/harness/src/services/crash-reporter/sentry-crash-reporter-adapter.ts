// src/services/crash-reporter/sentry-crash-reporter-adapter.ts
// The one file that imports @sentry/react-native (the ESLint vendor rule and check-crash-reporting
// enforce it). Creating the adapter does nothing: Sentry.init runs on the first setConsent(true),
// which the app calls after the first screen, so no report and no network request happen before
// the person's choice is known. Reports that arrive earlier wait in a bounded queue.
import * as Sentry from '@sentry/react-native';

import { filterBreadcrumb, scrubEvent } from './crash-scrubber';

import type {
  CrashBreadcrumb,
  CrashReportContext,
  CrashReporterPort,
  CrashReporterStatus,
} from './crash-reporter-port';
import type { CrashReportingConfig } from '@/config/crash-reporting-config';

/** Reports and breadcrumbs kept while the choice is pending; the oldest are dropped first. */
export const PENDING_LIMIT = 30;
/** Breadcrumbs the SDK keeps per event. */
export const MAX_BREADCRUMBS = 50;

type Pending =
  | { readonly kind: 'report'; readonly error: unknown; readonly context: CrashReportContext }
  | { readonly kind: 'breadcrumb'; readonly breadcrumb: CrashBreadcrumb };

/** The SDK options: privacy first, release and dist from the native build, one rejection tracker. */
export function sentryOptions(
  dsn: string,
  config: CrashReportingConfig,
): Sentry.ReactNativeOptions {
  const tracing =
    config.tracesSampleRate > 0
      ? {
          tracesSampleRate: config.tracesSampleRate,
          profilesSampleRate: Math.min(config.profilesSampleRate, config.tracesSampleRate),
        }
      : {};
  return {
    dsn,
    // The variant, so preview crashes never mix with the store build's (the SDK would say production).
    environment: config.environment,
    // No release and no dist: the native SDK names them <bundle id>@<version>+<build> and <build>,
    // the same names the build's symbol upload uses, so native and JavaScript events agree.
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableCaptureFailedRequests: false,
    maxBreadcrumbs: MAX_BREADCRUMBS,
    ...tracing,
    // The app's error net keeps Hermes' one rejection tracker and forwards rejections itself;
    // Sentry's own tracker would replace the net's (Hermes keeps the last caller's options).
    integrations: [Sentry.reactNativeErrorHandlersIntegration({ onunhandledrejection: false })],
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => filterBreadcrumb(breadcrumb),
  };
}

/** Sends one queued item; an SDK failure goes to onError. */
function sendToSentry(item: Pending, onError: (error: unknown) => void): void {
  try {
    if (item.kind === 'report') {
      Sentry.captureException(item.error, {
        level: item.context.isFatal ? 'fatal' : 'error',
        tags: { source: item.context.source },
      });
      return;
    }
    const { category, message, data } = item.breadcrumb;
    Sentry.addBreadcrumb({
      category: `app.${category}`,
      message,
      level: 'info',
      ...(data === undefined ? {} : { data }),
    });
  } catch (error: unknown) {
    onError(error);
  }
}

/** Starts the SDK; false (and onError) when the native side refuses. */
function startSentry(
  dsn: string,
  config: CrashReportingConfig,
  onError: (error: unknown) => void,
): boolean {
  try {
    Sentry.init(sentryOptions(dsn, config));
    return true;
  } catch (error: unknown) {
    onError(error);
    return false;
  }
}

/**
 * Creates the Sentry CrashReporterPort. Called once, by the composition root. `onError` receives
 * the SDK's own failures (the error log records them); no member ever throws.
 */
export function createSentryCrashReporterAdapter(
  config: CrashReportingConfig,
  onError: (error: unknown) => void,
): CrashReporterPort {
  const { dsn } = config;
  let current: CrashReporterStatus = dsn === null ? 'off' : 'waiting';
  let pending: Pending[] = [];
  // Once closed, the SDK stays closed for this run (close() shuts the native SDK down
  // asynchronously, so an init right after it could be shut down too); the saved choice applies
  // again at the next launch.
  let isClosed = false;
  const accept = (item: Pending): void => {
    if (current === 'reporting') sendToSentry(item, onError);
    else if (current === 'waiting') pending = [...pending, item].slice(-PENDING_LIMIT);
  };
  const setConsent = (isGranted: boolean): void => {
    if (dsn === null || isClosed || (isGranted && current === 'reporting')) return;
    const waiting = pending;
    pending = [];
    if (!isGranted) {
      if (current === 'reporting') {
        isClosed = true;
        Sentry.close().catch(onError);
      }
      current = 'off';
      return;
    }
    current = startSentry(dsn, config, onError) ? 'reporting' : 'off';
    if (current === 'reporting') for (const item of waiting) sendToSentry(item, onError);
  };
  return {
    setConsent,
    captureException: (error, context) => {
      accept({ kind: 'report', error, context });
    },
    addBreadcrumb: (breadcrumb) => {
      accept({ kind: 'breadcrumb', breadcrumb });
    },
    // Sentry.flush resolves false on failure and never rejects (read from @sentry/react-native 7.11).
    flush: () => (current === 'reporting' ? Sentry.flush() : Promise.resolve(false)),
    status: () => current,
  };
}
