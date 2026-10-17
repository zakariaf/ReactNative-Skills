// src/hooks/use-crash-reporting-consent.ts
// Applies the person's crash-report choice once the first screen is up, and again whenever it
// changes (a settings toggle). Before `isReady` nothing is applied, so the SDK never starts, and
// never opens a connection, while the splash still covers the app.
import { useEffect } from 'react';

import type { CrashReporterPort } from '@/services/crash-reporter/crash-reporter-port';

export type CrashReportingConsentInput = {
  /** True once the startup gate released the splash (useStartupReady). */
  readonly isReady: boolean;
  /** The saved choice; the contract's consentModel decides its first-launch value. */
  readonly isGranted: boolean;
};

/** Hands the choice to the reporter after the first frame; call once, in the app root. */
export function useCrashReportingConsent(
  crashReporter: Pick<CrashReporterPort, 'setConsent'>,
  { isReady, isGranted }: CrashReportingConsentInput,
): void {
  useEffect(() => {
    if (isReady) crashReporter.setConsent(isGranted);
  }, [crashReporter, isReady, isGranted]);
}
