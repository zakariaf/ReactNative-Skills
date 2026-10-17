// src/config/admob-ids.ts
// The app's AdMob IDs, read only by app.config.ts (app code never imports this file: real unit IDs
// reach the app through expo.extra.adUnits in live builds only). The developer creates the AdMob apps
// and ad units in the AdMob console and gives these values; never invent them. Until then the
// placeholders (publisher 0000000000000000) keep the format so every variant's config evaluates;
// check-ads notes them, and the release gates refuse a store build that still carries them.
// Neutral: Node loads it with app.config.ts.
import type { AdmobAppIds } from './ads-config.ts';

/** iOS and Android are separate AdMob apps, each with a banner, an interstitial and a rewarded unit. */
export const ADMOB_IDS: AdmobAppIds = {
  ios: {
    appId: 'ca-app-pub-0000000000000000~0000000001',
    units: {
      banner: 'ca-app-pub-0000000000000000/0000000011',
      interstitial: 'ca-app-pub-0000000000000000/0000000012',
      rewarded: 'ca-app-pub-0000000000000000/0000000013',
    },
  },
  android: {
    appId: 'ca-app-pub-0000000000000000~0000000002',
    units: {
      banner: 'ca-app-pub-0000000000000000/0000000021',
      interstitial: 'ca-app-pub-0000000000000000/0000000022',
      rewarded: 'ca-app-pub-0000000000000000/0000000023',
    },
  },
};
