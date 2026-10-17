// app.config.ts
import type { ExpoConfig } from 'expo/config';

export default function appConfig(): ExpoConfig {
  return { name: 'Notes', slug: 'notes', plugins: ['expo-router'] };
}
