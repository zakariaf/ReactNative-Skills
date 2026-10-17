// app.config.ts
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  return {
    ...config,
    name: 'Tasks',
    slug: 'tasks',
    // Phones stay in portrait; iPads and large Android displays rotate anyway.
    orientation: 'portrait',
    ios: { bundleIdentifier: 'com.example.tasks', supportsTablet: true },
    android: { package: 'com.example.tasks' },
    plugins: ['expo-router', './plugins/with-task-widgets.js'],
  };
}
