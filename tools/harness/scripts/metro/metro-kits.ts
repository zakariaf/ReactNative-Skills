// scripts/metro/metro-kits.ts
// The app's Metro kits, which the canonical metro.config.js composes (compose-metro-config.ts, the
// Metro slot); a kit never edits metro.config.js. Crash reporting's kit builds the base config with
// Sentry's getSentryExpoConfig, which starts from Expo's getDefaultConfig and adds a debug-ID module
// to every bundle, so a running app reports which source map its frames need (verified on Expo SDK
// 57: Expo's default writes the debug ID into the map only). metro.config.js still sets cacheVersion
// on the final object. Node loads this file with type stripping: the package subpath keeps its .js.
import { getSentryExpoConfig } from '@sentry/react-native/metro.js';

import type { MetroKit } from './compose-metro-config.ts';

/** Every Metro kit of the app, in the order their transforms run. */
export const METRO_KITS: readonly MetroKit[] = [
  { name: 'crash-reporting', baseConfig: (projectRoot) => getSentryExpoConfig(projectRoot) },
];
