// app.config.ts
import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Tasks',
  slug: 'tasks',
  ios: { bundleIdentifier: 'com.example.tasks' },
  android: { package: 'com.example.tasks' },
  plugins: ['expo-router'],
};

export default config;
