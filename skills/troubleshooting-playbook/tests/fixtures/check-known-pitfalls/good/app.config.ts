// app.config.ts
import { resolveAppVariant } from './src/config/app-variant.ts';

import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = resolveAppVariant(process.env);
  return {
    ...config,
    name: variant === 'production' ? 'Tasks' : `Tasks (${variant})`,
    slug: 'tasks',
    plugins: [
      ['expo-localization', { supportedLocales: { ios: ['en', 'ar'], android: ['en', 'ar'] } }],
      ['react-native-google-mobile-ads', { iosAppId: 'ca-app-pub-1111111111111111~2222222222', androidAppId: 'ca-app-pub-1111111111111111~3333333333' }],
      ['expo-tracking-transparency', { userTrackingPermission: 'Ads stay relevant when you allow tracking.' }],
    ],
    android: { predictiveBackGestureEnabled: false },
  };
};
