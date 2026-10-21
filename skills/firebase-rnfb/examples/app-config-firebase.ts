// examples/app-config-firebase.ts: the Firebase lines of app.config.ts (app-variants-and-environment owns
// the whole file; merge these into it). Config files come from EAS file variables, never from git.
import type { ExpoConfig } from 'expo/config';

export const firebaseConfigPart = {
  ios: { googleServicesFile: process.env['GOOGLE_SERVICES_PLIST'] },
  android: { googleServicesFile: process.env['GOOGLE_SERVICES_JSON'] },
  plugins: [
    '@react-native-firebase/app',
    '@react-native-firebase/auth',
    '@react-native-firebase/app-check',
    // React Native Firebase resolves the Firebase Apple SDK with Swift Package Manager: dynamic frameworks.
    ['expo-build-properties', { ios: { useFrameworks: 'dynamic' } }],
  ],
} satisfies Partial<ExpoConfig>;
