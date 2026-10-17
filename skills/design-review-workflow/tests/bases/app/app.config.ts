// app.config.ts
// A small Tasks app: what the design-review checkers read (version, appearance, tablets, orientation).
import type { ExpoConfig } from 'expo/config';

export default function appConfig(): ExpoConfig {
  return {
    name: 'Tasks',
    slug: 'tasks',
    version: '1.0.0',
    orientation: 'portrait',
    scheme: 'tasks',
    userInterfaceStyle: 'automatic',
    ios: { bundleIdentifier: 'com.example.tasks', supportsTablet: true },
    android: { package: 'com.example.tasks' },
  };
}
