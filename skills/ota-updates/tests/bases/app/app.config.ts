// app.config.ts
// A Tasks app with over-the-air updates: one EAS project id, the update settings from
// src/config/updates-config.ts, the same for every variant.
import { resolveAppVariant, variantIdentity } from './src/config/app-variant.ts';
import { updatesConfig } from './src/config/updates-config.ts';

import type { VariantIdentity } from './src/config/app-variant.ts';
import type { ConfigContext, ExpoConfig } from 'expo/config';

const BASE: VariantIdentity = { appId: 'com.acme.tasks', name: 'Tasks', scheme: 'tasks' };

/** The EAS project (eas init); updates.url is built from it. */
const EAS_PROJECT_ID = '9b1f3c2a-4d5e-4f60-8a7b-1c2d3e4f5a6b';

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  const variant = resolveAppVariant(process.env);
  const identity = variantIdentity(BASE, variant);
  return {
    ...config,
    name: identity.name,
    slug: 'tasks',
    version: '1.2.0',
    scheme: identity.scheme,
    ios: { bundleIdentifier: identity.appId },
    android: { package: identity.appId },
    extra: { ...config.extra, eas: { projectId: EAS_PROJECT_ID } },
    ...updatesConfig(EAS_PROJECT_ID),
    plugins: ['expo-router'],
  };
}
