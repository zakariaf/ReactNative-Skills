// app.config.ts: the only app config. Expo reads its default export.
import type { ConfigContext, ExpoConfig } from 'expo/config';

const BASE_ID = 'com.example.tasks';
const VARIANTS = ['development', 'preview', 'production'] as const;
const SUFFIX = { development: '.dev', preview: '.preview', production: '' };

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  const variant = VARIANTS.find((item) => item === process.env['APP_VARIANT']) ?? 'development';
  const id = `${BASE_ID}${SUFFIX[variant]}`;
  return {
    ...config,
    name: 'Tasks',
    slug: 'tasks',
    scheme: 'tasks',
    ios: { bundleIdentifier: id },
    android: { package: id, predictiveBackGestureEnabled: true },
    extra: { appVariant: variant },
  };
}
