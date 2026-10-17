// app.config.ts
import type { ExpoConfig } from 'expo/config';

export default function appConfig(): ExpoConfig {
  return {
    name: 'Tasks',
    slug: 'tasks',
    scheme: 'tasks',
    android: { package: 'com.acme.tasks' },
    plugins: ['expo-router'],
  };
}
