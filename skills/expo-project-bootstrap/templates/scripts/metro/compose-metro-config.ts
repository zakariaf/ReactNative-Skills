// scripts/metro/compose-metro-config.ts
// The Metro slot of the canonical root: an optional kit that needs Metro (crash reporting's debug
// ids) lists a MetroKit in the app's scripts/metro/metro-kits.ts, and metro.config.js composes the
// config from it; without that file, or with an empty list, the config is Expo's default, exactly as
// before. A kit never edits metro.config.js. At most one kit replaces the base config (Sentry's
// getSentryExpoConfig builds on Expo's getDefaultConfig itself); every kit's transform runs after it
// in list order; metro.config.js sets cacheVersion last, on the final object.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import type { MetroConfig } from 'expo/metro-config';

/**
 * One kit's part of the Metro config. Its results are typed loosely on purpose: Expo and the kits'
 * packages type the same config object with different copies of Metro's types (Sentry's
 * getSentryExpoConfig returns Metro's input config type), and Metro reads the object as it is.
 */
export type MetroKit = {
  /** Kebab-case: errors name it. */
  readonly name: string;
  /** Builds the base config instead of Expo's getDefaultConfig, on top of Expo's own. One kit at most. */
  readonly baseConfig?: (projectRoot: string) => object;
  /** Changes the config after the base: headers, resolver or serializer additions. */
  readonly transform?: (config: MetroConfig) => object;
};

/** Where an app lists its Metro kits (export const METRO_KITS: readonly MetroKit[]). */
export const METRO_KITS_FILE = 'scripts/metro/metro-kits.ts';

/** The app's Metro kits: METRO_KITS of scripts/metro/metro-kits.ts, or none without that file. */
export function readMetroKits(projectRoot: string): readonly MetroKit[] {
  const file = join(projectRoot, METRO_KITS_FILE);
  if (!existsSync(file)) return [];
  const loaded: unknown = createRequire(join(projectRoot, 'package.json'))(file);
  const kits = (loaded as { readonly METRO_KITS?: unknown }).METRO_KITS;
  if (!Array.isArray(kits)) {
    throw new TypeError(`${METRO_KITS_FILE} must export METRO_KITS, a list of Metro kits`);
  }
  return kits as readonly MetroKit[];
}

/** Expo's default config, or the one kit's base, then every kit's transform in list order. */
export function composeMetroConfig(
  projectRoot: string,
  getDefaultConfig: (projectRoot: string) => MetroConfig,
  kits: readonly MetroKit[],
): MetroConfig {
  const bases = kits.filter((kit) => kit.baseConfig !== undefined);
  if (bases.length > 1) {
    const names = bases.map((kit) => kit.name).join(', ');
    throw new Error(
      `Metro kits ${names} each replace the base config: keep one, make the others transforms`,
    );
  }
  const base = (bases[0]?.baseConfig?.(projectRoot) ??
    getDefaultConfig(projectRoot)) as MetroConfig;
  return kits.reduce((config, kit) => (kit.transform?.(config) ?? config) as MetroConfig, base);
}
