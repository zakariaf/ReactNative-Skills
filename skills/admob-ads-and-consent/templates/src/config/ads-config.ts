// src/config/ads-config.ts
// The build-time half of the ads: which ads mode a build gets, which AdMob app ID each platform's
// native project receives, and which unit IDs reach the app. Neutral: app.config.ts runs this file in
// Node (type stripping), so it imports only the neutral app-variant.ts, with the file extension.
import { isStoreVariant } from './app-variant.ts';

import type { AppVariant, VariantEnv } from './app-variant.ts';

/** Every ads mode: 'off' requests nothing, 'test' serves Google's test ads, 'live' real ones. */
export const ADS_MODES = ['off', 'test', 'live'] as const;
export type AdsMode = (typeof ADS_MODES)[number];

/** The three ad units of one platform. */
export type AdmobUnitIds = {
  readonly banner: string;
  readonly interstitial: string;
  readonly rewarded: string;
};
/** One platform's AdMob app and units (console: Apps > App settings, and Ad units). */
export type AdmobPlatformIds = { readonly appId: string; readonly units: AdmobUnitIds };
/** The app's AdMob IDs on both platforms (src/config/admob-ids.ts). */
export type AdmobAppIds = { readonly ios: AdmobPlatformIds; readonly android: AdmobPlatformIds };

const GOOGLE_SAMPLE_PUBLISHER = '3940256099942544';
/** Google's sample app IDs, which serve test ads only (the only place they may be typed). */
export const GOOGLE_SAMPLE_APP_IDS = {
  ios: `ca-app-pub-${GOOGLE_SAMPLE_PUBLISHER}~1458002511`,
  android: `ca-app-pub-${GOOGLE_SAMPLE_PUBLISHER}~3347511713`,
} as const;

const APP_ID = /^ca-app-pub-\d{16}~\d{10}$/;
const UNIT_ID = /^ca-app-pub-\d{16}\/\d{10}$/;

function parseAdsMode(raw: string): AdsMode {
  const mode = ADS_MODES.find((candidate) => candidate === raw);
  if (mode === undefined) throw new Error(`ADS_MODE=${raw} is not one of ${ADS_MODES.join('|')}`);
  return mode;
}

/**
 * The ads mode of this build: ADS_MODE, or by default 'test' for development and preview and 'live'
 * for production. Real ads in a testing variant and test ads in a store build both throw: the first
 * risks invalid traffic on the AdMob account, the second ships an app that never earns.
 */
export function resolveAdsMode(env: VariantEnv, variant: AppVariant): AdsMode {
  const raw = env['ADS_MODE'];
  const isStore = isStoreVariant(variant);
  if (raw === undefined || raw === '') return isStore ? 'live' : 'test';
  const mode = parseAdsMode(raw);
  if (mode === 'live' && !isStore) throw new Error(`ADS_MODE=live in a ${variant} build`);
  if (mode === 'test' && isStore) throw new Error('ADS_MODE=test in a production build');
  return mode;
}

/**
 * Throws unless the IDs keep AdMob's format and none is Google's sample. The template's placeholders
 * (publisher 0000000000000000) pass, so every variant's config evaluates before the developer has the
 * real IDs; check-ads notes them and the release gates refuse them.
 */
export function assertLiveIds(ids: AdmobPlatformIds): void {
  const all = [ids.appId, ...Object.values(ids.units)];
  const isValid =
    APP_ID.test(ids.appId) && Object.values(ids.units).every((unit) => UNIT_ID.test(unit));
  const isSample = all.some((id) => id.includes(GOOGLE_SAMPLE_PUBLISHER));
  if (!isValid || isSample) {
    throw new Error(`invalid live AdMob ids (format or Google's sample): ${JSON.stringify(ids)}`);
  }
}

/** The options of the react-native-google-mobile-ads config plugin. */
export type AdmobPluginOptions = {
  readonly iosAppId: string;
  readonly androidAppId: string;
  readonly delayAppMeasurementInit: true;
  readonly skAdNetworkItems: readonly string[];
};

/**
 * The SDK is linked in every build, so both native projects always get an app ID (a missing one
 * stops the app at launch): the app's own only in live builds, Google's sample otherwise. No
 * userTrackingUsageDescription: the expo-tracking-transparency plugin and the locales write it.
 */
export function admobPluginOptions(
  mode: AdsMode,
  ids: AdmobAppIds,
  skAdNetworkItems: readonly string[],
): AdmobPluginOptions {
  const isLive = mode === 'live';
  if (isLive) {
    assertLiveIds(ids.ios);
    assertLiveIds(ids.android);
  }
  return {
    iosAppId: isLive ? ids.ios.appId : GOOGLE_SAMPLE_APP_IDS.ios,
    androidAppId: isLive ? ids.android.appId : GOOGLE_SAMPLE_APP_IDS.android,
    delayAppMeasurementInit: true,
    skAdNetworkItems,
  };
}

/** What app.config.ts spreads into expo.extra: the mode, and the unit IDs only in live builds. */
export type AdsExtraConfig = {
  readonly adsMode: AdsMode;
  readonly adUnits?: { readonly ios: AdmobUnitIds; readonly android: AdmobUnitIds };
};

/**
 * Real unit IDs reach the app only in live builds; otherwise the key is left out (a null in extra
 * arrives as {} at runtime).
 */
export function adsExtra(mode: AdsMode, ids: AdmobAppIds): AdsExtraConfig {
  if (mode !== 'live') return { adsMode: mode };
  assertLiveIds(ids.ios);
  assertLiveIds(ids.android);
  return { adsMode: mode, adUnits: { ios: ids.ios.units, android: ids.android.units } };
}
