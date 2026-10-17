// apps/arena-chase/app-settings.ts
// Every per-app value of Arena Chase. Only app.config.ts reads this file; app code reads the
// runtime subset from expo.extra through one typed reader. No value is null: null reached the
// device as {} through expo.extra. The links and, when the app shows ads, the ad ids are
// placeholders until the developer supplies the real ones; the complete check refuses each by name.
import type { AppSettings } from '@acme/app-config/with-app-settings.ts';

export const appSettings: AppSettings = {
  id: 'arena-chase',
  appName: {
    en: 'Arena Chase',
    ar: 'Arena Chase',
  },
  bundleId: 'com.acme.arenachase',
  version: '1.0.0',
  buildNumber: 1,
  products: {
    premium: 'com.acme.arenachase.premium',
  },
  links: {
    privacyPolicy: {
      host: 'example.com',
      path: '/arena-chase/privacy',
    },
    supportEmail: 'support@example.com',
  },
  ads: {
    isEnabled: true,
    ios: {
      appId: 'ca-app-pub-3940256099942544~1458002511',
      units: {
        banner: 'ca-app-pub-3940256099942544/2934735716',
        rewarded: 'ca-app-pub-3940256099942544/1712485313',
      },
    },
    android: {
      appId: 'ca-app-pub-3940256099942544~3347511713',
      units: {
        banner: 'ca-app-pub-3940256099942544/6300978111',
        rewarded: 'ca-app-pub-3940256099942544/5224354917',
      },
    },
  },
};
