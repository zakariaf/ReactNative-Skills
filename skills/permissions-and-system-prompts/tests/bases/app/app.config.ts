// app.config.ts
import { nativeLocales, sourceText } from './scripts/i18n/native-locales.ts';

import type { ConfigContext, ExpoConfig } from 'expo/config';

const NATIVE_TEXT_KEYS = {
  displayName: 'app.name',
  usageDescriptions: { NSCameraUsageDescription: 'permissions.camera.usage-description' },
};

export default function appConfig({ config, projectRoot }: ConfigContext): ExpoConfig {
  return {
    ...config,
    name: 'Tasks',
    slug: 'tasks',
    android: { package: 'com.example.tasks' },
    plugins: [
      'expo-router',
      [
        'expo-image-picker',
        {
          cameraPermission: sourceText(projectRoot, 'permissions.camera.usage-description'),
          photosPermission: false,
          microphonePermission: false,
        },
      ],
    ],
    locales: nativeLocales(projectRoot, NATIVE_TEXT_KEYS),
  };
}
