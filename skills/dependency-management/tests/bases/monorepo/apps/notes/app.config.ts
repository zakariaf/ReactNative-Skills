// apps/notes/app.config.ts (fixture)
import type { ExpoConfig } from 'expo/config';

export default function appConfig(): ExpoConfig {
  return { name: 'notes', slug: 'notes', plugins: ['expo-router'] };
}
