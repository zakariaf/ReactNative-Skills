// app.config.ts
// The ads lines of the app config (a shape: merge them into the app's own config, keep everything
// else). Node runs this file with type stripping, so relative imports keep their .ts extension.
import { ADMOB_IDS } from './src/config/admob-ids.ts';
import { admobPluginOptions, adsExtra, resolveAdsMode } from './src/config/ads-config.ts';
import { resolveAppVariant } from './src/config/app-variant.ts';
import { SKADNETWORK_IDS } from './src/config/skadnetwork-ids.ts';

import type { ConfigContext, ExpoConfig } from 'expo/config';

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  const variant = resolveAppVariant(process.env);
  // development and preview: test ads; production: live ads; ADS_MODE=off for E2E and screenshots.
  const adsMode = resolveAdsMode(process.env, variant);
  return {
    ...config,
    name: 'Tasks',
    slug: 'tasks',
    // The app's locales write NSUserTrackingUsageDescription in every language from the catalogs
    // (i18n-strings-and-catalogs' native locales); the plugin below gets the source text.
    locales: { en: { ios: { NSUserTrackingUsageDescription: 'Lets the app show ads that match your interests.' } } },
    plugins: [
      // Apple's App Tracking Transparency prompt: the only writer of the purpose text.
      [
        'expo-tracking-transparency',
        { userTrackingPermission: 'Lets the app show ads that match your interests.' },
      ],
      // Both platforms always get an app ID (the sample one unless live) and the SKAdNetwork list.
      ['react-native-google-mobile-ads', admobPluginOptions(adsMode, ADMOB_IDS, SKADNETWORK_IDS)],
    ],
    // adsMode, and the live unit IDs of both platforms only in live builds.
    extra: { ...config.extra, ...adsExtra(adsMode, ADMOB_IDS) },
  };
}
