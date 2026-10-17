// app.config.ts (a stand-in: app-variants-and-environment owns the real file). No 120 Hz key: Expo's
// prebuild template already sets CADisableMinimumFrameDurationOnPhone = true (plist-120hz).
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  return {
    ...config,
    name: 'Tasks',
    slug: 'tasks',
    ios: { bundleIdentifier: 'com.example.tasks' },
    android: { package: 'com.example.tasks' },
  };
}
