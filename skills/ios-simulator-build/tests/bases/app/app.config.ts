// app.config.ts
import type { ExpoConfig } from 'expo/config';

export default function appConfig(): ExpoConfig {
  return {
    name: 'Tasks',
    slug: 'tasks',
    scheme: 'tasks',
    ios: { bundleIdentifier: 'com.acme.tasks' },
    plugins: ['expo-router'],
  };
}
