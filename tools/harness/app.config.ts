// app.config.ts
// The only app config (no app.json): Expo reads its default export. APP_VARIANT picks the build:
// development (the dev client), preview (internal testing) or production (the stores), resolved by
// the canonical src/config/app-variant.ts (EXPO_PUBLIC_APP_VARIANT must equal it; an unset variant
// throws in a production bundle or on EAS Build). Each variant gets its own id, name, icon and URL
// scheme, so all three install side by side. The app name in every language and the languages the
// app declares come from the i18n catalogs (withI18n). Node runs this file with type stripping:
// relative imports keep their .ts extension and only erasable syntax works.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { linkNativeConfig, readLinkContract } from './scripts/deep-links/link-native-config.ts';
import { readAppLanguages } from './scripts/i18n/app-languages.ts';
import { nativeLocales, sourceText } from './scripts/i18n/native-locales.ts';
import { resolveAppVariant, variantIdentity } from './src/config/app-variant.ts';
import { PRIVACY_MANIFESTS } from './src/config/privacy-manifest.ts';

import type { AppVariant, VariantEnv, VariantIdentity } from './src/config/app-variant.ts';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/** The production identity. The name equals the source catalog's app.name. */
const BASE: VariantIdentity = {
  appId: 'com.example.harness',
  name: 'Tasks',
  scheme: 'harness',
};

/** The store icon on iOS, inside assets/icons/production/: the SDK 57 template's Icon Composer folder. */
const STORE_IOS_ICON = 'expo.icon';

/**
 * The catalog keys the native projects read: the app name, and the purpose strings iOS prints in the
 * permission dialogs of the plugins below (nativeLocales writes them in every language; each plugin
 * gets its base text from the source catalog through sourceText()).
 */
const NATIVE_TEXT_KEYS = {
  displayName: 'app.name',
  usageDescriptions: {
    NSCameraUsageDescription: 'permissions.camera.usage-description',
    NSUserTrackingUsageDescription: 'permissions.tracking.usage-description',
  },
};

type AdMobAppIds = { readonly iosAppId: string; readonly androidAppId: string };

/** Google's published sample AdMob app ids, which serve test ads only. */
const ADMOB_SAMPLE_APP_IDS: AdMobAppIds = {
  iosAppId: 'ca-app-pub-3940256099942544~1458002511',
  androidAppId: 'ca-app-pub-3940256099942544~3347511713',
};

/**
 * The AdMob app id per variant (GADApplicationIdentifier, com.google.android.gms.ads.APPLICATION_ID):
 * without one the Google Mobile Ads SDK stops the app at launch. Testing variants always use the
 * sample ids; the harness never ships, so production does too (an app puts its own ids there).
 */
const ADMOB_APP_IDS: Readonly<Record<AppVariant, AdMobAppIds>> = {
  development: ADMOB_SAMPLE_APP_IDS,
  preview: ADMOB_SAMPLE_APP_IDS,
  production: ADMOB_SAMPLE_APP_IDS,
};

type VariantIcons = {
  readonly fallback: string;
  readonly ios: string;
  readonly androidForeground: string;
  readonly androidBackground: string;
  readonly androidMonochrome: string;
};

/** One icon folder per variant; development and preview carry the badge make-variant-icons drew. */
function iconsFor(variant: AppVariant): VariantIcons {
  const folder = `./assets/icons/${variant}`;
  return {
    fallback: `${folder}/icon.png`,
    ios: variant === 'production' ? `${folder}/${STORE_IOS_ICON}` : `${folder}/icon.png`,
    androidForeground: `${folder}/android-foreground.png`,
    androidBackground: `${folder}/android-background.png`,
    androidMonochrome: `${folder}/android-monochrome.png`,
  };
}

/**
 * Every config plugin, with the options the app means. Each installed package whose plugin prebuild
 * would apply on its own is listed too, so every native change it makes is a line here.
 */
function pluginsFor(variant: AppVariant, projectRoot: string): NonNullable<ExpoConfig['plugins']> {
  return [
    'expo-router',
    // Only the development build registers the dev client's exp+<slug> scheme.
    ['expo-dev-client', { addGeneratedScheme: variant === 'development' }],
    [
      'expo-splash-screen',
      { backgroundColor: '#208AEF', image: './assets/images/splash-icon.png', imageWidth: 76 },
    ],
    // Photos attach to a task through the system picker, which needs no library permission:
    // photosPermission false drops NSPhotoLibraryUsageDescription. The app never records sound:
    // microphonePermission false drops that purpose string and Android's RECORD_AUDIO.
    [
      'expo-image-picker',
      {
        photosPermission: false,
        cameraPermission: sourceText(projectRoot, 'permissions.camera.usage-description'),
        microphonePermission: false,
      },
    ],
    // The App Tracking Transparency prompt (admob-ads-and-consent asks before personalized ads).
    [
      'expo-tracking-transparency',
      { userTrackingPermission: sourceText(projectRoot, 'permissions.tracking.usage-description') },
    ],
    // Ads: the app id per variant. NSUserTrackingUsageDescription stays with the plugin above.
    ['react-native-google-mobile-ads', ADMOB_APP_IDS[variant]],
    // Sign in with Apple: adds the com.apple.developer.applesignin entitlement.
    'expo-apple-authentication',
    // Notifications: the aps-environment entitlement. It names the APNs environment: development for
    // the development client, production for preview and production (an ad-hoc or store export
    // signs with the profile's entitlement; push-notifications' APNS_MODE). Android's small icon is
    // white on transparent, and a push without a channel lands in contracts/push.json defaultChannel.
    [
      'expo-notifications',
      {
        mode: variant === 'development' ? 'development' : 'production',
        icon: './assets/images/notification-icon.png',
        color: '#208AEF',
        defaultChannel: 'general',
      },
    ],
    // Crash reporting (crash-reporting-and-observability): every native build uploads its source map
    // and debug symbols to this Sentry project. The harness has no Sentry account, so the slugs are
    // examples; no harness build uploads anything (it never runs EAS Build, and sentry-cli reads the
    // upload token only from the build's environment).
    ['@sentry/react-native/expo', { organization: 'example-org', project: 'tasks-harness' }],
    // Import and export files: the defaults (no iCloud container).
    'expo-document-picker',
    // The database and its snapshots: adds Android's storage and INTERNET permissions.
    'expo-file-system',
    // Task manager: UIBackgroundModes fetch (prebuild applies it on its own anyway).
    'expo-task-manager',
    // Background work: UIBackgroundModes processing and the BGTaskScheduler identifier (SDK 57's
    // prebuild does not apply this plugin on its own; background-tasks' background-plugin rule).
    'expo-background-task',
  ];
}

/**
 * Firebase Cloud Messaging's file (public identifiers, safe to commit; an EAS file variable works too):
 * without it Android issues no push token. The harness has no Firebase project, so it is set only
 * once the file exists, and Android builds work without push until then (push-notifications).
 */
function googleServicesFile(
  projectRoot: string,
  env: VariantEnv,
): { readonly googleServicesFile?: string } {
  const file = env['GOOGLE_SERVICES_JSON'] ?? './google-services.json';
  return existsSync(join(projectRoot, file)) ? { googleServicesFile: file } : {};
}

/** The EAS project id the developer set after eas init (EAS_PROJECT_ID), or none. */
function easProjectId(env: VariantEnv): string | undefined {
  return env['EAS_PROJECT_ID'];
}

/** Android: the package, the adaptive icon layers, predictive back and the blocked permissions. */
function androidConfigFor(
  variant: AppVariant,
  appId: string,
  icons: VariantIcons,
): NonNullable<ExpoConfig['android']> {
  return {
    package: appId,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: icons.androidForeground,
      backgroundImage: icons.androidBackground,
      monochromeImage: icons.androidMonochrome,
    },
    predictiveBackGestureEnabled: true,
    // Merged by the prebuild template and libraries, never used by this app (its files stay in
    // its sandbox); the dev client's overlay keeps SYSTEM_ALERT_WINDOW in the development variant
    // only (permissions-and-system-prompts, config-and-wiring section 3).
    blockedPermissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      ...(variant === 'development' ? [] : ['android.permission.SYSTEM_ALERT_WINDOW']),
    ],
  };
}

function baseConfig(
  config: ConfigContext['config'],
  variant: AppVariant,
  projectRoot: string,
): ExpoConfig {
  const identity = variantIdentity(BASE, variant);
  const icons = iconsFor(variant);
  // contracts/deep-links.json has no hosts yet: no applinks entitlement and no App Links filter, so
  // links reach the app only through its custom scheme (and +native-intent decides what they open).
  const links = linkNativeConfig(readLinkContract(projectRoot), variant);
  return {
    ...config,
    name: identity.name,
    // iOS and Android only. The template's web pair (react-dom, react-native-web) stays installed for
    // Expo Router; web-support adds 'web' here together with its contract, headers and storage gate.
    platforms: ['ios', 'android'],
    slug: 'harness',
    version: '1.0.0',
    orientation: 'portrait',
    icon: icons.fallback,
    scheme: identity.scheme,
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: identity.appId,
      icon: icons.ios,
      supportsTablet: true,
      privacyManifests: PRIVACY_MANIFESTS,
      ...(links.associatedDomains && { associatedDomains: links.associatedDomains }),
    },
    // Verified App Links of the variant's hosts (deep-links-and-universal-links); none yet.
    android: {
      ...androidConfigFor(variant, identity.appId, icons),
      intentFilters: links.intentFilters,
      ...googleServicesFile(projectRoot, process.env),
    },
    web: { output: 'static', favicon: './assets/images/favicon.png' },
    // Over-the-air updates stay off until ota-updates sets updates.url, runtimeVersion { policy:
    // 'fingerprint' } and enabled; Expo's tools (and knip) treat a config without this key as an app
    // that ships expo-updates.
    updates: { enabled: false },
    plugins: pluginsFor(variant, projectRoot),
    // The EAS project the Expo push service issues tokens for (eas init prints it; EAS Build writes
    // it on its own). The harness has none: readEasProjectId() finds no id and asks for no token.
    extra: { eas: { projectId: easProjectId(process.env) } },
    experiments: { typedRoutes: true, reactCompiler: true },
  };
}

type I18nInput = {
  readonly projectRoot: string;
  /** The catalog's app name -> this variant's name ('المهام' -> 'المهام (Dev)'). */
  readonly variantName: (name: string) => string;
};

/** Native texts from the catalogs, and the languages declared to iOS and Android 13+. */
function withI18n(config: ExpoConfig, { projectRoot, variantName }: I18nInput): ExpoConfig {
  const infoPlist = { ...config.ios?.infoPlist, CFBundleAllowMixedLocalizations: true };
  const { languages } = readAppLanguages(projectRoot);
  const supportedLocales = { ios: [...languages], android: [...languages] };
  return {
    ...config,
    ios: { ...config.ios, infoPlist },
    locales: nativeLocales(projectRoot, NATIVE_TEXT_KEYS, { variantName }),
    plugins: [...(config.plugins ?? []), ['expo-localization', { supportedLocales }]],
  };
}

export default function appConfig({ config, projectRoot }: ConfigContext): ExpoConfig {
  const variant = resolveAppVariant(process.env);
  const variantName = (name: string): string => variantIdentity({ ...BASE, name }, variant).name;
  return withI18n(baseConfig(config, variant, projectRoot), { projectRoot, variantName });
}
