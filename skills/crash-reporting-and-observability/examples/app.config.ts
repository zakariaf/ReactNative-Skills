// app.config.ts
// An example shape (imitate it, do not copy it): the one plugin entry crash reporting adds to the
// app config, and the build-time half of the production DSN rule. organization and project are not
// secret; the upload token is never here (sentry-cli reads SENTRY_AUTH_TOKEN from the EAS secret or
// the CI secret by itself). With the entry, every native release build uploads its source map (Xcode
// "Bundle React Native code and images", Gradle sentry.gradle) and its debug symbols (dSYMs;
// ProGuard/NDK through the Android Gradle plugin).
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * A production store build without a DSN would throw in parseCrashReportingConfig on every launch.
 * Fail the EAS build instead: EAS sets EAS_BUILD=true on its build workers, so a local
 * `expo export` (the privacy audit's production export) or a development run never trips it. The
 * runtime throw stays as the second check (setup-and-wiring, section 4).
 */
function assertProductionDsn(env: NodeJS.ProcessEnv): void {
  const isStoreBuild = env.EAS_BUILD === 'true' && env.APP_VARIANT === 'production';
  if (isStoreBuild && (env.EXPO_PUBLIC_CRASH_REPORTER_DSN ?? '').trim() === '') {
    throw new Error(
      'EXPO_PUBLIC_CRASH_REPORTER_DSN is empty in the production EAS environment: eas env:set --name EXPO_PUBLIC_CRASH_REPORTER_DSN --environment production --visibility plaintext',
    );
  }
}

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  assertProductionDsn(process.env);
  return {
    ...config,
    name: 'Tasks',
    slug: 'tasks',
    plugins: [
      'expo-router',
      ['@sentry/react-native/expo', { organization: 'tasks-org', project: 'tasks-app' }],
    ],
  };
}
