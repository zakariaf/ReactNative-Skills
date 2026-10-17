// app.config.ts
// The analytics lines of app.config.ts (a shape: merge them into the app's own config). The mode, key
// and host come from the build's environment (the EAS environment of its profile: ANALYTICS_MODE,
// ANALYTICS_KEY, ANALYTICS_HOST); the store declarations come from contracts/analytics.json. Node
// runs this file with type stripping, so relative imports keep their .ts extension.
import { analyticsCollectedDataTypes } from './scripts/analytics/analytics-manifest.ts';
import { analyticsExtra } from './src/config/analytics-config.ts';
import { PRIVACY_MANIFESTS } from './src/config/privacy-manifest.ts';
import { resolveAppVariant, variantIdentity } from './src/config/app-variant.ts';

import type { VariantIdentity } from './src/config/app-variant.ts';
import type { ConfigContext, ExpoConfig } from 'expo/config';

const BASE: VariantIdentity = { appId: 'com.example.tasks', name: 'Tasks', scheme: 'tasks' };

export default function appConfig({ config, projectRoot }: ConfigContext): ExpoConfig {
  const variant = resolveAppVariant(process.env);
  const identity = variantIdentity(BASE, variant);
  return {
    ...config,
    name: identity.name,
    slug: 'tasks',
    ios: {
      bundleIdentifier: identity.appId,
      // privacy-and-store-declarations owns the manifest (required-reason APIs, NSPrivacyTracking);
      // analytics adds its collected data types to it, never replaces it. PRIVACY_MANIFESTS lists
      // no collected types of its own; if it ever does, merge both lists here.
      privacyManifests: {
        ...PRIVACY_MANIFESTS,
        NSPrivacyCollectedDataTypes: [...analyticsCollectedDataTypes(projectRoot)],
      },
    },
    android: { package: identity.appId },
    extra: { ...config.extra, ...analyticsExtra(variant, process.env, identity.appId) },
  };
}
