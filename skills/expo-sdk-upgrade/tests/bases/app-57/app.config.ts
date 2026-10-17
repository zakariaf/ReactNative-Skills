// app.config.ts
import type { ExpoConfig } from 'expo/config';

type PluginList = NonNullable<ExpoConfig['plugins']>;

function pluginsFor(): PluginList {
  return ['expo-router', ['./plugins/with-variant-marker.ts', { variant: 'production' }]];
}

export default function appConfig(): ExpoConfig {
  return {
    name: 'Tasks',
    slug: 'tasks',
    ios: { bundleIdentifier: 'com.example.tasks' },
    android: { package: 'com.example.tasks', predictiveBackGestureEnabled: true },
    plugins: pluginsFor(),
  };
}
