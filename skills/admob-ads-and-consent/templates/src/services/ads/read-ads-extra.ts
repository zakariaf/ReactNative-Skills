// src/services/ads/read-ads-extra.ts
// The ads facts app.config.ts writes into expo.extra: adsMode, and adUnits (both platforms) only in
// live builds. Constants.expoConfig is the config embedded at build time, or, while an EAS Update
// runs, that update's manifest, which `eas update` evaluated from app.config.ts with its own
// environment (expo-constants prefers the updates manifest). So the app reads the facts through
// readAdsExtraForBinary: a manifest made for another variant's binary turns ads off. Anything
// unexpected falls back to 'off': a broken config must never show real ads.
import Constants from 'expo-constants';

import type { AdUnitIds } from './ads-port';
import type { AdsMode } from '@/config/ads-config';

/** The live unit IDs of both platforms. */
export type PlatformAdUnits = { readonly ios: AdUnitIds; readonly android: AdUnitIds };

/** What createAdsPort needs from the build. */
export type AdsExtra = {
  readonly adsMode: AdsMode;
  /** Only in live builds; null otherwise (app.config.ts omits the key). */
  readonly adUnits: PlatformAdUnits | null;
};

const MODES: readonly AdsMode[] = ['off', 'test', 'live'];
const NO_ADS: AdsExtra = { adsMode: 'off', adUnits: null };

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function isUnitIds(value: unknown): value is AdUnitIds {
  if (!isObject(value)) return false;
  return ['banner', 'interstitial', 'rewarded'].every(
    (key) => typeof Reflect.get(value, key) === 'string',
  );
}

function readUnits(value: unknown): PlatformAdUnits | null {
  if (!isObject(value)) return null;
  const ios: unknown = Reflect.get(value, 'ios');
  const android: unknown = Reflect.get(value, 'android');
  return isUnitIds(ios) && isUnitIds(android) ? { ios, android } : null;
}

/** Parses an expo.extra object (Constants.expoConfig.extra by default). */
export function readAdsExtra(extra: unknown = Constants.expoConfig?.extra): AdsExtra {
  if (!isObject(extra)) return NO_ADS;
  const mode: unknown = Reflect.get(extra, 'adsMode');
  const adsMode = MODES.find((candidate) => candidate === mode) ?? 'off';
  return { adsMode, adUnits: readUnits(Reflect.get(extra, 'adUnits')) };
}

/** The app IDs a config names: ios.bundleIdentifier and android.package (one id per variant). */
export function manifestAppIds(config: unknown): readonly string[] {
  if (!isObject(config)) return [];
  const read = (platform: string, key: string): unknown => {
    const section: unknown = Reflect.get(config, platform);
    return isObject(section) ? Reflect.get(section, key) : undefined;
  };
  const ids = [read('ios', 'bundleIdentifier'), read('android', 'package')];
  return ids.filter((id): id is string => typeof id === 'string' && id !== '');
}

/**
 * The ads facts of this binary. `nativeAppId` is the running binary's own id
 * (Application.applicationId from expo-application: no update can change it; null when unknown).
 * Every variant has its own app id, so a manifest that names other ids was made for another
 * variant's binary, for example an update published with the production environment to a preview
 * channel (live ads for testers) or from a development shell to production (test ads in the store):
 * ads turn off instead.
 */
export function readAdsExtraForBinary(
  nativeAppId: string | null,
  config: unknown = Constants.expoConfig,
): AdsExtra {
  const extra = readAdsExtra(isObject(config) ? Reflect.get(config, 'extra') : undefined);
  if (nativeAppId === null) return extra;
  const ids = manifestAppIds(config);
  return ids.length === 0 || ids.includes(nativeAppId) ? extra : NO_ADS;
}
