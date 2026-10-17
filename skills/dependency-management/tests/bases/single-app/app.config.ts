// app.config.ts (fixture): the only app config.
import type { ExpoConfig } from 'expo/config';

export default function appConfig(): ExpoConfig {
  return { name: 'Tasks', slug: 'tasks', plugins: ['expo-router'] };
}
