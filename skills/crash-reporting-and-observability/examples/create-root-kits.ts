// src/services/create-root-kits.ts
// An example shape (imitate it, do not copy it): app-startup-and-bootstrap's root-kit registry with
// the crash reporting kit, in an app that keeps the person's choice in the settings store
// (settings-and-preferences' crashReportsEnabled field, examples/settings-schema.ts). startApp opens
// the settings before it creates the kits and passes the store here; the kit reads the field once the
// splash is gone and follows every change of the settings row. Without a settings row yet, pass
// fixedCrashConsent(false) instead (opt-in: never reports). Every other line of the template stays.
import { readCrashReportingConfig } from '@/config/crash-reporting-config';
import { createCrashReportingKit } from '@/services/crash-reporter/crash-reporting-root-kit';
import { createSentryCrashReporterAdapter } from '@/services/crash-reporter/sentry-crash-reporter-adapter';

import type { AppData } from '@/data/app-data-context';
import type { Language } from '@/i18n/languages';
import type { CrashConsentSource } from '@/services/crash-reporter/crash-reporting-root-kit';
import type { RootKit } from '@/services/root-kits/root-kit';
import type { Services } from '@/services/services-context';
import type { SettingsStore } from '@/stores/settings/settings-store';

export type RootKitsInput = {
  readonly services: Services;
  readonly data: AppData;
  readonly language: Language;
  /** settings-and-preferences: opened in startApp before the kits. */
  readonly settings: SettingsStore;
};

/** The saved crash-report choice, read now and on every change of the settings store. */
function settingsCrashConsent(settings: SettingsStore): CrashConsentSource {
  return {
    isGranted: () => settings.getState().settings.crashReportsEnabled,
    subscribe: (onChange) => settings.subscribe(onChange),
  };
}

/** Every optional kit, in the order their providers nest (the first outermost). */
export function createRootKits({ data, settings }: RootKitsInput): readonly RootKit[] {
  // The adapter does no I/O: the SDK starts only when the kit applies a yes, after the splash. Its
  // own failures (a missing native module) land in the local error log.
  const crashReporter = createSentryCrashReporterAdapter(readCrashReportingConfig(), (error) => {
    data.errorLog.record('service', error);
  });
  return [createCrashReportingKit({ crashReporter, consent: settingsCrashConsent(settings) })];
}
