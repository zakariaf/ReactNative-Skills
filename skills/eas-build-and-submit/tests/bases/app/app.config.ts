// app.config.ts
// The app config of the Tasks fixture: one production identity, a literal version, the EAS link.
// Remote versions (eas.json) keep the build numbers, so neither ios.buildNumber nor
// android.versionCode appears here.
import { resolveAppVariant, variantIdentity } from './src/config/app-variant.ts';

import type { VariantIdentity } from './src/config/app-variant.ts';
import type { ConfigContext, ExpoConfig } from 'expo/config';

const BASE: VariantIdentity = {
  appId: 'com.example.tasks',
  name: 'Tasks',
  scheme: 'tasks',
};

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  const identity = variantIdentity(BASE, resolveAppVariant(process.env));
  return {
    ...config,
    owner: 'tasks-team',
    name: identity.name,
    slug: 'tasks',
    version: '1.2.0',
    scheme: identity.scheme,
    ios: { bundleIdentifier: identity.appId, supportsTablet: true },
    android: { package: identity.appId },
    extra: { eas: { projectId: '00000000-0000-4000-8000-000000000000' } },
  };
}
