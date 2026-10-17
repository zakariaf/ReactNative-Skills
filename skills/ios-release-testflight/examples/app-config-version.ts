// app.config.ts (excerpt: a shape to merge into the app's own config, never copied whole)
// The local iOS lane reads and bumps these lines. One version, one iOS build number, one team id.
import { resolveAppVariant, variantIdentity } from './src/config/app-variant.ts';

import type { ConfigContext, ExpoConfig } from 'expo/config';

/** The store version (CFBundleShortVersionString, Android versionName): raised per release. */
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
    ios: {
      bundleIdentifier: identity.appId,
      // A string in the app config (Expo's ios.buildNumber type); release:ios bumps the const above.
      buildNumber: String(IOS_BUILD_NUMBER),
      // Prebuild writes it to DEVELOPMENT_TEAM; exported once in the shell profile, never committed as a secret.
      appleTeamId: process.env['APPLE_TEAM_ID'],
      // The export-compliance answer (ITSAppUsesNonExemptEncryption): false for HTTPS-only apps.
      config: { usesNonExemptEncryption: false },
    },
  };
}

// With EAS remote versioning (eas.json cli.appVersionSource "remote") EAS counts ios.buildNumber on
// its servers and ignores these values: then drop IOS_BUILD_NUMBER and the local lane.
