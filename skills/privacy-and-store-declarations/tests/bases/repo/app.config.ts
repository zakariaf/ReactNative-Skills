// app.config.ts
import { PRIVACY_MANIFESTS } from './src/config/privacy-manifest.ts';

import type { ExpoConfig } from 'expo/config';

export default function appConfig(): ExpoConfig {
  return {
    name: 'Tasks',
    slug: 'tasks',
    ios: { bundleIdentifier: 'com.acme.tasks', privacyManifests: PRIVACY_MANIFESTS },
    android: { package: 'com.acme.tasks' },
    plugins: [
      'expo-router',
      ['expo-tracking-transparency', { userTrackingPermission: 'Lets the app show ads that match your interests.' }],
      ['react-native-google-mobile-ads', { iosAppId: 'ca-app-pub-1111111111111111~2222222222', androidAppId: 'ca-app-pub-1111111111111111~3333333333' }],
      'expo-iap',
      'expo-notifications',
    ],
  };
}
