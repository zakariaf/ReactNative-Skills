// app.config.ts (stand-in: only what the audio checker reads)
import { AUDIO_API_PLUGIN } from './src/config/audio-plugin.ts';

import type { ExpoConfig } from 'expo/config';

export default function appConfig(): ExpoConfig {
  return {
    name: 'Tasks',
    slug: 'tasks',
    plugins: ['expo-router', AUDIO_API_PLUGIN],
  };
}
