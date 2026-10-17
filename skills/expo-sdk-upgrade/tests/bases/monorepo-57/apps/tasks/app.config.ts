// apps/tasks/app.config.ts
import type { ExpoConfig } from 'expo/config';

export default function appConfig(): ExpoConfig {
  return { name: 'Tasks', slug: 'tasks', plugins: ['expo-router'] };
}
