// src/services/crash-reporter/crash-reporting-root-kit.tsx
// Crash reporting as a root kit (app-startup-and-bootstrap's slots): one entry in
// src/services/create-root-kits.ts plugs it into startup, and no root file changes. Its parts: the
// forward slot (every error report, after the local error log recorded it; the forwarder sends render
// errors and unhandled rejections) and the effects slot (mounted beside the root Stack after the
// splash release: the person's choice applied, and changes to it, then one route breadcrumb per route
// change). The registry creates the Sentry adapter, which does no I/O, and the consent source.
import { useSyncExternalStore } from 'react';

import { useCrashReportingConsent } from '@/hooks/use-crash-reporting-consent';
import { useRouteBreadcrumbs } from '@/hooks/use-route-breadcrumbs';

import { createCrashForwarder } from './crash-forwarder';

import type { CrashReporterPort } from './crash-reporter-port';
import type { RootKit } from '@/services/root-kits/root-kit';

/**
 * The person's saved crash-report choice, read synchronously and watched for changes (the shape of a
 * vanilla store: the settings store's crashReportsEnabled field, settings-and-preferences).
 */
export type CrashConsentSource = {
  readonly isGranted: () => boolean;
  readonly subscribe: (onChange: () => void) => () => void;
};

/**
 * A choice that never changes. fixedCrashConsent(false) until the app has a settings row for crash
 * reports: an opt-in app then never reports (the contract's consentModel decides the first value).
 */
export function fixedCrashConsent(isGranted: boolean): CrashConsentSource {
  return { isGranted: () => isGranted, subscribe: () => () => undefined };
}

export type CrashReportingKitInput = {
  readonly crashReporter: CrashReporterPort;
  readonly consent: CrashConsentSource;
};

type CrashReportingEffectsProps = CrashReportingKitInput;

/** Renders nothing: applies the choice once the splash is gone and records route breadcrumbs. */
function CrashReportingEffects({ crashReporter, consent }: CrashReportingEffectsProps): null {
  const isGranted = useSyncExternalStore(consent.subscribe, consent.isGranted);
  // The kit's effects mount only after the startup gate released the splash.
  useCrashReportingConsent(crashReporter, { isReady: true, isGranted });
  useRouteBreadcrumbs(crashReporter);
  return null;
}

/** The crash reporting kit: register it once in createRootKits. */
export function createCrashReportingKit(input: CrashReportingKitInput): RootKit {
  return {
    name: 'crash-reporting',
    forward: createCrashForwarder(input.crashReporter),
    effects: <CrashReportingEffects crashReporter={input.crashReporter} consent={input.consent} />,
  };
}
