// app.config.ts: Node loads it (relative imports with the extension, neutral files only).
import type { ConfigContext, ExpoConfig } from 'expo/config';

import { resolveAppVariant } from './src/config/app-variant.ts';

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  const variant = resolveAppVariant(process.env['APP_VARIANT']);
  return { ...config, name: 'Tasks', slug: 'tasks', extra: { appVariant: variant } };
}
