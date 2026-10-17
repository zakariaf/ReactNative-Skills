// app.config.ts (example): the OTA lines of a Tasks app's config. Everything else stays as the
// app's skeleton has it (expo-project-bootstrap, app-variants-and-environment).
import { resolveAppVariant, variantIdentity } from './src/config/app-variant.ts';
import { updatesConfig } from './src/config/updates-config.ts';

import type { VariantIdentity } from './src/config/app-variant.ts';
import type { ConfigContext, ExpoConfig } from 'expo/config';

const BASE: VariantIdentity = { appId: 'com.acme.tasks', name: 'Tasks', scheme: 'tasks' };

/** The EAS project (`eas init` prints it). One constant for extra.eas.projectId and updates.url. */
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
    owner: 'acme',
    extra: { ...config.extra, eas: { projectId: EAS_PROJECT_ID } },
    // Before OTA is wanted this line reads `updates: { enabled: false },` instead.
    ...updatesConfig(EAS_PROJECT_ID),
    plugins: ['expo-router'],
  };
}
