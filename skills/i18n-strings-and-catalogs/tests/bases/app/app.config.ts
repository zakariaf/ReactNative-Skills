// app.config.ts (fixture: native texts and declared languages come from the catalogs)
import { readAppLanguages } from './scripts/i18n/app-languages.ts';
import { nativeLocales } from './scripts/i18n/native-locales.ts';

import type { ConfigContext, ExpoConfig } from 'expo/config';

const NATIVE_TEXT_KEYS = {
  displayName: 'app.name',
  usageDescriptions: { NSCameraUsageDescription: 'permissions.camera.usage-description' },
};

export default function appConfig({ config, projectRoot }: ConfigContext): ExpoConfig {
  const { languages } = readAppLanguages(projectRoot);
  return {
    ...config,
    name: 'Tasks',
    slug: 'tasks',
    ios: { bundleIdentifier: 'org.tasks.app', infoPlist: { CFBundleAllowMixedLocalizations: true } },
    android: { package: 'org.tasks.app' },
    locales: nativeLocales(projectRoot, NATIVE_TEXT_KEYS),
    plugins: ['expo-router', ['expo-localization', { supportedLocales: { ios: languages, android: languages } }]],
  };
}
