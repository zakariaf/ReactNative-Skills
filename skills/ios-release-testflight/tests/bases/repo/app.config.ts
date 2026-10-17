// app.config.ts
import { resolveAppVariant, variantIdentity } from './src/config/app-variant.ts';

import type { ConfigContext, ExpoConfig } from 'expo/config';

/** The store version (CFBundleShortVersionString, versionName): raised per release. */
const APP_VERSION = '1.4.0';
/** The iOS build number (CFBundleVersion): only scripts/release/bump-build-number.ts raises it. */
const IOS_BUILD_NUMBER = 14;

const BASE = { appId: 'com.acme.tasks', name: 'Tasks', scheme: 'tasks' };

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  const identity = variantIdentity(BASE, resolveAppVariant(process.env));
  return {
    ...config,
    name: identity.name,
    slug: 'tasks',
    version: APP_VERSION,
    scheme: identity.scheme,
    ios: {
      bundleIdentifier: identity.appId,
      buildNumber: String(IOS_BUILD_NUMBER),
      appleTeamId: process.env['APPLE_TEAM_ID'],
      config: { usesNonExemptEncryption: false },
    },
    extra: { supportEmail: 'help@acme-tasks.app' },
  };
}
