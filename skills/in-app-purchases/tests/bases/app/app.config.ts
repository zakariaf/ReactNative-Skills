// app.config.ts
import type { ExpoConfig } from 'expo/config';

export default function appConfig(): ExpoConfig {
  return {
    name: 'Tasks',
    slug: 'tasks',
    ios: { bundleIdentifier: 'com.example.tasks' },
    android: { package: 'com.example.tasks' },
    plugins: ['expo-router', 'expo-iap'],
  };
}
