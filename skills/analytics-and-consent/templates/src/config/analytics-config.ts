// src/config/analytics-config.ts
// Which analytics project a build talks to. app.config.ts runs analyticsExtra() in Node at build time
// (expo.extra.analytics); the composition root reads it back with readAnalyticsExtra() at run time.
// Pure and neutral like app-variant.ts: no `process`, React Native or Expo import, so Node's type
// stripping runs it inside app.config.ts. The project key is a publishable write-only client key
// (anyone with the app can read expo.extra); a secret key or personal API key never goes here.
import type { AppVariant, VariantEnv } from './app-variant';

/** off: no SDK at all · test: the vendor's test project · live: the production project. */
export const ANALYTICS_MODES = ['off', 'test', 'live'] as const;
export type AnalyticsMode = (typeof ANALYTICS_MODES)[number];

/**
 * The modes each variant may use, the default first. Development and preview builds never send to
 * the production project, production never sends to the test project, and every variant can be
 * built with analytics off (screenshots, E2E, the network audit).
 */
export const ANALYTICS_MODES_BY_VARIANT: Readonly<Record<AppVariant, readonly AnalyticsMode[]>> = {
  development: ['off', 'test'],
  preview: ['off', 'test'],
  production: ['live', 'off'],
};

/** What expo.extra.analytics holds. */
export type AnalyticsExtra = {
  readonly mode: AnalyticsMode;
  /** The app id this extra was built for (an EAS Update for another variant turns analytics off). */
  readonly appId: string;
  readonly apiKey: string | null;
  /** The vendor's ingestion host, chosen on purpose (region), never the SDK default. */
  readonly host: string | null;
};

/** What the composition root gets: off, or everything the adapter needs. */
export type AnalyticsRuntime =
  | { readonly mode: 'off' }
  | { readonly mode: 'test' | 'live'; readonly apiKey: string; readonly host: string };

const OFF: AnalyticsRuntime = { mode: 'off' };

function isMode(value: unknown): value is AnalyticsMode {
  return ANALYTICS_MODES.some((mode) => mode === value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isHttpsHost(value: unknown): value is string {
  return isText(value) && /^https:\/\/[a-z0-9.-]+(?::\d+)?$/.test(value);
}

/** The mode of this build: ANALYTICS_MODE when the variant allows it, else the variant's default. */
export function resolveAnalyticsMode(variant: AppVariant, env: VariantEnv): AnalyticsMode {
  const allowed = ANALYTICS_MODES_BY_VARIANT[variant];
  const requested = env['ANALYTICS_MODE'];
  if (requested === undefined || requested === '') return allowed[0] ?? 'off';
  const match = allowed.find((mode) => mode === requested);
  if (match === undefined) {
    throw new Error(
      `ANALYTICS_MODE=${requested} is not allowed for ${variant} (${allowed.join('|')})`,
    );
  }
  return match;
}

/**
 * expo.extra.analytics for app.config.ts. ANALYTICS_KEY and ANALYTICS_HOST come from the build's
 * environment (the EAS environment of its profile); a mode that sends without them throws, so a
 * store build never ships analytics that silently goes nowhere.
 */
export function analyticsExtra(
  variant: AppVariant,
  env: VariantEnv,
  appId: string,
): { readonly analytics: AnalyticsExtra } {
  const mode = resolveAnalyticsMode(variant, env);
  if (mode === 'off') return { analytics: { mode, appId, apiKey: null, host: null } };
  const apiKey = env['ANALYTICS_KEY'];
  const host = env['ANALYTICS_HOST'];
  if (!isText(apiKey) || !isHttpsHost(host)) {
    throw new Error(`analytics mode ${mode} needs ANALYTICS_KEY and an https ANALYTICS_HOST`);
  }
  return { analytics: { mode, appId, apiKey, host } };
}

/**
 * Reads expo.extra.analytics at run time. Anything malformed, or an extra built for another app id
 * (an EAS Update published with another variant's environment), is off: never the wrong project.
 */
export function readAnalyticsExtra(extra: unknown, applicationId: string | null): AnalyticsRuntime {
  if (typeof extra !== 'object' || extra === null) return OFF;
  const analytics = (extra as { readonly analytics?: unknown }).analytics;
  if (typeof analytics !== 'object' || analytics === null) return OFF;
  const { mode, appId, apiKey, host } = analytics as Record<string, unknown>;
  if (!isMode(mode) || mode === 'off' || appId !== applicationId) return OFF;
  if (!isText(apiKey) || !isHttpsHost(host)) return OFF;
  return { mode, apiKey, host };
}
