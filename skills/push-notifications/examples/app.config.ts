// app.config.ts
// The push parts of the app config (the rest is the app's own; the variant comes from
// app-variants-and-environment's canonical resolveAppVariant, which makes an unset variant an error
// on EAS Build and in a production bundle). Every value here is baked into the binary at prebuild:
// a change needs a new build, never an OTA update. Node runs this file with type stripping, so the
// relative import keeps its .ts extension.
import { resolveAppVariant } from './src/config/app-variant.ts';

import type { AppVariant } from './src/config/app-variant.ts';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/** The EAS project (eas init prints it). Public: it names the project, it grants nothing. */
const EAS_PROJECT_ID = '__EAS_PROJECT_ID__';

/** Equal to contracts/push.json defaultChannel: where a push without channelId lands on Android. */
const DEFAULT_PUSH_CHANNEL = 'general';

/**
 * The aps-environment each variant states: production for every build that ships through TestFlight,
 * ad hoc or the App Store (they talk to the production APNs); development for the dev client.
 * Distribution export signs with the provisioning profile's entitlement anyway (Expo's docs: Xcode
 * changes it to production in a release archive), so this states the build's intent; it is not what
 * makes a store build receive pushes (not verified on a device here).
 */
const APNS_MODE: Readonly<Record<AppVariant, 'development' | 'production'>> = {
  development: 'development',
  preview: 'production',
  production: 'production',
};

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  const variant = resolveAppVariant(process.env);
  return {
    ...config,
    name: 'Tasks',
    slug: 'tasks',
    ios: { bundleIdentifier: '__IOS_BUNDLE_ID__' },
    android: {
      package: '__ANDROID_PACKAGE__',
      // Registers the app with Firebase Cloud Messaging: without it Android issues no push token.
      // The file holds public identifiers (safe to commit); an EAS file variable works too.
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
    },
    plugins: [
      [
        'expo-notifications',
        {
          mode: APNS_MODE[variant],
          // Android's small icon: 96x96, white on transparent (a full-colour icon shows as a square).
          icon: './assets/images/notification-icon.png',
          color: '#208AEF',
          defaultChannel: DEFAULT_PUSH_CHANNEL,
        },
      ],
    ],
    extra: { eas: { projectId: EAS_PROJECT_ID } },
  };
}
