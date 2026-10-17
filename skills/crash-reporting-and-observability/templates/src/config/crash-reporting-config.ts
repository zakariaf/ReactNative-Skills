// src/config/crash-reporting-config.ts
// What crash reporting may do in this build. The DSN comes from EXPO_PUBLIC_CRASH_REPORTER_DSN (a
// public value by design: it lets a client send events, nothing more), read with dot access in the
// app's environment reader (app-variants-and-environment), or by readCrashReportingConfig below, and
// passed here with the variant. The development variant never reports; preview and production report
// as their own environment, so a tester's crash never lands among the store build's issues.
import { currentAppVariant } from './current-app-variant';

import type { AppVariant } from './app-variant';

/** Share of sessions traced for performance; 0 keeps tracing off (the default). */
export const TRACES_SAMPLE_RATE = 0;
/** Share of traced sessions profiled; never above TRACES_SAMPLE_RATE. */
export const PROFILES_SAMPLE_RATE = 0;

export type CrashReportingConfig = {
  /** null: this build never starts the SDK, whatever the person chose. */
  readonly dsn: string | null;
  /** The reporting environment: the variant, never the SDK's own development/production guess. */
  readonly environment: AppVariant;
  readonly tracesSampleRate: number;
  readonly profilesSampleRate: number;
};

/** https://<key>@<host>[:port][/<path prefix>...]/<project id>; a self-hosted Sentry may add a prefix. */
const DSN = /^https:\/\/[0-9a-z]+@[0-9a-z.-]+(:\d+)?(\/[\w.-]+)*\/\d+$/iu;

/**
 * Checks the DSN once, at startup. Throws with the variable's name when a value is malformed, or
 * when a production build has none: a build made without its EAS environment then fails on the
 * first launch in testing, not silently in the field.
 */
export function parseCrashReportingConfig(
  raw: string | undefined,
  variant: AppVariant,
): CrashReportingConfig {
  const value = raw?.trim() ?? '';
  if (value !== '' && !DSN.test(value)) {
    throw new Error(
      `EXPO_PUBLIC_CRASH_REPORTER_DSN must look like https://<key>@<host>[/<path>]/<project-id>, got "${value}"`,
    );
  }
  if (value === '' && variant === 'production') {
    throw new Error(
      'EXPO_PUBLIC_CRASH_REPORTER_DSN is not set: set it in the production EAS environment',
    );
  }
  return {
    dsn: variant === 'development' || value === '' ? null : value,
    environment: variant,
    tracesSampleRate: TRACES_SAMPLE_RATE,
    profilesSampleRate: PROFILES_SAMPLE_RATE,
  };
}

/**
 * This build's config: its EAS environment's DSN (Metro inlines EXPO_PUBLIC_CRASH_REPORTER_DSN at
 * build time; dot access only) and its variant. The root-kit registry reads it once per JS run.
 */
export function readCrashReportingConfig(): CrashReportingConfig {
  return parseCrashReportingConfig(process.env.EXPO_PUBLIC_CRASH_REPORTER_DSN, currentAppVariant());
}
