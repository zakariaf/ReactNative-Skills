// src/services/error-log/use-report-error.ts
// Example (a shape to imitate): the rejection handler for fire-and-forget work. The error-reporting
// port (architecture-and-boundaries) records and never throws, so it is safe inside any .catch().
import { useServices } from '@/services/services-context';

import type { ErrorSource } from './error-log-port';

/** Returns a rejection handler for fire-and-forget work: `task().catch(reportError)`. */
export function useReportError(source: ErrorSource): (error: unknown) => void {
  const { errorLog } = useServices();
  return (error: unknown): void => {
    errorLog.record(source, error);
  };
}
