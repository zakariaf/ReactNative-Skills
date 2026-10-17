// src/services/crash-reporter/crash-forwarder.ts
// The crash reporting kit's part of the error net: the root skeleton's sink records every report in
// the local error log first (app-startup-and-bootstrap's createKitErrorSink), then hands it to this
// forwarder, which sends only the reports Sentry cannot see by itself. Sentry chains the React
// Native global handler on its own (and flushes a fatal error before the app ends), so forwarding
// 'global-handler' too would send every uncaught exception twice. Render errors (caught by Expo
// Router's ErrorBoundary) and unhandled rejections (the net keeps Hermes' tracker) reach Sentry only
// through here, the ones of the first moments included (the sink replays them to the kits).
import type { CrashReporterPort } from './crash-reporter-port';
import type { ErrorNetSource, ErrorReport } from '@/services/error-net/error-net';

/** The net sources the crash reporter receives from this forwarder: exactly these two. */
export const FORWARDED_SOURCES: readonly ErrorNetSource[] = ['render', 'unhandled-rejection'];

/** The kit's forward slot: render errors and rejections go to the crash reporter, nothing else. */
export function createCrashForwarder(
  crashReporter: Pick<CrashReporterPort, 'captureException'>,
): (report: ErrorReport) => void {
  return (report) => {
    if (FORWARDED_SOURCES.includes(report.source)) {
      crashReporter.captureException(report.error, {
        source: report.source,
        isFatal: report.isFatal,
      });
    }
  };
}
