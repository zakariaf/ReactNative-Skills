// scripts/metro/animation-assets-kit.ts
// Owned by the lottie-and-rive skill. A Metro kit (the canonical metro.config.js composes it from
// the app's scripts/metro/metro-kits.ts; a kit never edits metro.config.js) that makes Metro bundle
// .riv and .lottie files as assets, so require('@/assets/animations/<file>.riv') resolves to a
// bundled asset. Expo SDK 57's default assetExts (@expo/metro-config 57.0.13, read 2026-10-21)
// lists neither; Lottie .json needs nothing, because json is already a source extension.
import type { MetroKit } from './compose-metro-config.ts';
import type { MetroConfig } from 'expo/metro-config';

export const ANIMATION_ASSET_EXTENSIONS: readonly string[] = ['riv', 'lottie'];

/** The config with the animation extensions added to resolver.assetExts (each once). */
export function withAnimationAssets(config: MetroConfig): MetroConfig {
  const { assetExts } = config.resolver;
  const added = ANIMATION_ASSET_EXTENSIONS.filter((ext) => !assetExts.includes(ext));
  return { ...config, resolver: { ...config.resolver, assetExts: [...assetExts, ...added] } };
}

export const ANIMATION_ASSETS_KIT: MetroKit = {
  name: 'animation-assets',
  transform: withAnimationAssets,
};
