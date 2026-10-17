// src/config/app-variant.ts
// The build variant: development (the dev client), preview (internal testing) or production (the
// stores). Pure and neutral: app.config.ts runs this file in Node (type stripping) and app code
// imports it, so it reads no `process`, React Native or Expo module. One canonical copy, owned by
// the app-variants-and-environment skill; the build, release and ads skills ship the same bytes.

/** Every variant, in promotion order. */
export const APP_VARIANTS = ['development', 'preview', 'production'] as const;
export type AppVariant = (typeof APP_VARIANTS)[number];

/** An environment snapshot: app.config.ts passes process.env; tests and tools pass an object. */
export type VariantEnv = Readonly<Record<string, string | undefined>>;

/** What a variant changes in the app config. The production values are the base. */
export type VariantIdentity = {
  /** The iOS bundle identifier and the Android package (one id for both platforms). */
  readonly appId: string;
  /** The home-screen name. */
  readonly name: string;
  /** The URL scheme that deep links open. */
  readonly scheme: string;
};

type TestingVariant = Exclude<AppVariant, 'production'>;

const SUFFIX: Readonly<Record<TestingVariant, string>> = { development: 'dev', preview: 'preview' };
const LABEL: Readonly<Record<TestingVariant, string>> = { development: 'Dev', preview: 'Preview' };

/** True for the three variant names, false for anything else. */
export function isAppVariant(value: string): value is AppVariant {
  return APP_VARIANTS.some((variant) => variant === value);
}

/** Parses one variant name; anything else throws, so a typo never builds the store app. */
export function parseAppVariant(raw: string): AppVariant {
  const match = APP_VARIANTS.find((variant) => variant === raw);
  if (match === undefined) {
    throw new Error(`APP_VARIANT=${raw} is not one of ${APP_VARIANTS.join('|')}`);
  }
  return match;
}

function isSet(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

/**
 * Where an unset variant is an error: production bundling (`expo export`, `eas update` and a release
 * build's bundling step run with NODE_ENV=production) and EAS Build workers (EAS_BUILD=true).
 */
function needsExplicitVariant(env: VariantEnv): boolean {
  return env['NODE_ENV'] === 'production' || env['EAS_BUILD'] === 'true';
}

/**
 * The variant of this build. APP_VARIANT is read by app.config.ts; EXPO_PUBLIC_APP_VARIANT is
 * inlined into the JS bundle by Metro, which runs in another process, so every build exports both.
 * Both unset: development for local work, an error in a production bundle or on EAS. They differ:
 * an error, because the native app and its JS bundle would disagree about what they are.
 */
export function resolveAppVariant(env: VariantEnv): AppVariant {
  const forConfig = env['APP_VARIANT'];
  const forBundle = env['EXPO_PUBLIC_APP_VARIANT'];
  if (!isSet(forConfig) && !isSet(forBundle)) {
    if (needsExplicitVariant(env)) {
      throw new Error(
        'APP_VARIANT and EXPO_PUBLIC_APP_VARIANT are not set: production bundles and EAS builds name their variant (development|preview|production)',
      );
    }
    return 'development';
  }
  if (forConfig !== forBundle) {
    throw new Error(
      `EXPO_PUBLIC_APP_VARIANT=${forBundle ?? ''} must equal APP_VARIANT=${forConfig ?? ''}: the JS bundle and the native app must agree`,
    );
  }
  return parseAppVariant(forConfig ?? '');
}

/** The two variables a build of `variant` exports (build scripts, eas.json profiles, CI jobs). */
export function variantEnv(
  variant: AppVariant,
): Readonly<Record<'APP_VARIANT' | 'EXPO_PUBLIC_APP_VARIANT', AppVariant>> {
  return { APP_VARIANT: variant, EXPO_PUBLIC_APP_VARIANT: variant };
}

/** The identity of `variant`: production keeps the base; the others extend id, name and scheme. */
export function variantIdentity(base: VariantIdentity, variant: AppVariant): VariantIdentity {
  if (variant === 'production') {
    return base;
  }
  return {
    appId: `${base.appId}.${SUFFIX[variant]}`,
    name: `${base.name} (${LABEL[variant]})`,
    scheme: `${base.scheme}-${SUFFIX[variant]}`,
  };
}

/** Only production builds go to the App Store and Google Play. */
export function isStoreVariant(variant: AppVariant): boolean {
  return variant === 'production';
}
