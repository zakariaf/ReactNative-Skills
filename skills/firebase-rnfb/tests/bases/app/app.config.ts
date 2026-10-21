// app.config.ts (a stand-in for the checker: the real one is app-variants-and-environment's)
import type { ExpoConfig } from 'expo/config';

export default (): ExpoConfig => ({
  name: 'Tasks',
  slug: 'tasks',
  ios: { bundleIdentifier: 'com.example.tasks', googleServicesFile: process.env['GOOGLE_SERVICES_PLIST'] },
  android: { package: 'com.example.tasks', googleServicesFile: process.env['GOOGLE_SERVICES_JSON'] },
  plugins: [
    '@react-native-firebase/app',
    '@react-native-firebase/app-check',
    ['expo-build-properties', { ios: { useFrameworks: 'dynamic' } }],
  ],
});
