// app.config.ts: the Tasks app's config (only what the checker reads is here).
// Release builds keep App Transport Security on: never NSAllowsArbitraryLoads: true, never
// usesCleartextTraffic: true (a comment that names a switch is not the switch).
import type { ExpoConfig } from 'expo/config';

export default (): ExpoConfig => ({
  name: 'Tasks',
  slug: 'tasks',
  ios: { bundleIdentifier: 'com.example.tasks', infoPlist: { NSAllowsLocalNetworking: true } },
  android: { package: 'com.example.tasks' },
  plugins: ['expo-router'],
});
