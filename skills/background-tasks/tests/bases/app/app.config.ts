// app.config.ts
import type { ExpoConfig } from 'expo/config';

export default (): ExpoConfig => ({
  name: 'Tasks',
  slug: 'tasks',
  plugins: [
    'expo-router',
    // UIBackgroundModes fetch (prebuild applies this plugin on its own anyway).
    'expo-task-manager',
    // UIBackgroundModes processing and the BGTaskScheduler identifier.
    'expo-background-task',
  ],
});
