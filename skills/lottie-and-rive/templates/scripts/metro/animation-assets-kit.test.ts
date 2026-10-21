// scripts/metro/animation-assets-kit.test.ts
import { ANIMATION_ASSETS_KIT, withAnimationAssets } from './animation-assets-kit.ts';

import type { MetroConfig } from 'expo/metro-config';

const expoDefault = { resolver: { assetExts: ['png', 'ttf'] } } as unknown as MetroConfig;

describe('withAnimationAssets', () => {
  it('adds riv and lottie to the asset extensions', () => {
    expect(withAnimationAssets(expoDefault).resolver.assetExts).toStrictEqual([
      'png',
      'ttf',
      'riv',
      'lottie',
    ]);
  });

  it('adds each extension once when the config already has it', () => {
    const twice = withAnimationAssets(withAnimationAssets(expoDefault));
    expect(twice.resolver.assetExts).toStrictEqual(['png', 'ttf', 'riv', 'lottie']);
  });

  it('runs as a transform of the Metro slot', () => {
    expect(ANIMATION_ASSETS_KIT.transform?.(expoDefault)).toStrictEqual(
      withAnimationAssets(expoDefault),
    );
  });
});
