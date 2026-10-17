// src/services/error-net/connect-error-log.ts (example: a shape to imitate, never copied)
// Called once by the startup code right after the composition root has created the services
// (examples/root-layout.tsx): connecting flushes the reports the net buffered since the installer
// ran, oldest first, and routes every later report to the log. Connect again when a better log
// becomes available (the persistent one, once storage is open): connect replaces the sink.
// The log's record must be synchronous and must never throw: a fatal error ends the process right
// after the global handler returns, and a reload discards whatever is still only in memory.
import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { ErrorNet } from '@/services/error-net/error-net';

/** Routes every net report into the error log (and, when the app ships one, the crash reporter). */
export function connectErrorLog(
  net: Pick<ErrorNet, 'connect'>,
  errorLog: Pick<ErrorLogPort, 'record'>,
): void {
  net.connect((report) => {
    errorLog.record(report.source, report.error);
  });
}
