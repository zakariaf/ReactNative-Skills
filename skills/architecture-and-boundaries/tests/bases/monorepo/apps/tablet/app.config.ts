import type { ConfigContext, ExpoConfig } from 'expo/config';

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  return { ...config, name: 'Acme', slug: 'acme' };
}
