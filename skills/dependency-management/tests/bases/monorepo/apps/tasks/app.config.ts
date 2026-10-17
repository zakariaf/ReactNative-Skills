// apps/tasks/app.config.ts (fixture)
import type { ExpoConfig } from 'expo/config';

export default function appConfig(): ExpoConfig {
  return { name: 'tasks', slug: 'tasks', plugins: ['expo-router'] };
}
