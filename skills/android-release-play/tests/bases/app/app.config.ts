// app.config.ts
import { resolveAppVariant, variantIdentity } from './src/config/app-variant.ts';

import type { ConfigContext, ExpoConfig } from 'expo/config';

/** Android's own counter; npm run release:android bumps it before each store build. */
const ANDROID_VERSION_CODE = 14;

const BASE = { appId: 'com.acme.tasks', name: 'Tasks', scheme: 'tasks' };

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  const variant = resolveAppVariant(process.env);
  const identity = variantIdentity(BASE, variant);
  return {
    ...config,
    name: identity.name,
    slug: 'tasks',
    version: '1.4.0',
    scheme: identity.scheme,
    ios: { bundleIdentifier: identity.appId },
    android: {
      package: identity.appId,
      versionCode: ANDROID_VERSION_CODE,
      blockedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW'],
    },
    plugins: [
      ['./plugins/with-upload-signing.ts', { applicationId: BASE.appId }],
      ['react-native-google-mobile-ads', { androidAppId: 'ca-app-pub-7356100422874109~5193461228' }],
    ],
  };
}
