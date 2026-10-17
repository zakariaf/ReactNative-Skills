// app.config.ts
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  const variant = process.env['APP_VARIANT'] ?? 'development';
  return { ...config, name: variant === 'production' ? 'Tasks' : `Tasks (${variant})`, slug: 'tasks' };
}
