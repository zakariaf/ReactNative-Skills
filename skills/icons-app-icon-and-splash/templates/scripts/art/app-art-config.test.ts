// scripts/art/app-art-config.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  iosAppearanceIcon,
  SPLASH_CANVAS_DP,
  SPLASH_IMAGE_WIDTH,
  splashPlugin,
} from './app-art-config.ts';
import { outputsToDraw, readAppArt } from './app-art-contract.ts';
import { PALETTE } from '../../src/theme/palette.ts';

function repoWith(contract: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'app-art-'));
  mkdirSync(join(root, 'contracts'));
  writeFileSync(join(root, 'contracts', 'app-art.json'), JSON.stringify(contract));
  return root;
}

describe('app art config', () => {
  let root = '';
  afterEach(() => {
    if (root !== '') rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('points iOS at the three appearance PNGs by default', () => {
    root = mkdtempSync(join(tmpdir(), 'app-art-'));

    expect(iosAppearanceIcon(root)).toStrictEqual({
      light: './assets/icons/production/icon.png',
      dark: './assets/icons/production/icon-dark.png',
      tinted: './assets/icons/production/icon-tinted.png',
    });
  });

  it('puts the splash images on the palette backgrounds, light and dark', () => {
    root = repoWith({ outputs: { splash: 'assets/splash/logo.png' } });

    expect(splashPlugin(root)).toStrictEqual([
      'expo-splash-screen',
      {
        image: './assets/splash/logo.png',
        imageWidth: SPLASH_IMAGE_WIDTH,
        backgroundColor: PALETTE.light.background,
        dark: {
          image: './assets/images/splash-icon-dark.png',
          backgroundColor: PALETTE.dark.background,
        },
      },
    ]);
  });

  it('shows the splash image no wider than the Android 12+ splash icon canvas', () => {
    expect(SPLASH_IMAGE_WIDTH).toBeLessThanOrEqual(SPLASH_CANVAS_DP);
  });

  it('keeps the feature graphic optional unless the contract says otherwise', () => {
    root = repoWith({ glyphArea: 0.7, icons: { allowImages: ['src/features/onboarding/*.jpg'] } });

    expect(readAppArt(root)).toMatchObject({ optional: ['featureGraphic'], glyphArea: 0.7 });
  });

  it('renders every image but the hand-made ones the contract lists as optional', () => {
    root = repoWith({ optional: ['dark', 'tinted', 'featureGraphic'] });

    const drawn = outputsToDraw(readAppArt(root));

    expect(drawn).not.toContain('dark');
    expect(drawn).not.toContain('tinted');
    expect(drawn).not.toContain('featureGraphic');
    expect(drawn).toContain('light');
    expect(drawn).toHaveLength(7);
  });

  it('refuses an unknown image, a non-PNG path, a glyph area out of range and an unknown key', () => {
    root = repoWith({ outputs: { banner: 'assets/banner.png' } });
    expect(() => readAppArt(root)).toThrow('"outputs.banner" is not a known image');
    rmSync(root, { recursive: true, force: true });

    root = repoWith({ outputs: { light: 'assets/icon.jpg' } });
    expect(() => readAppArt(root)).toThrow('must be a repo-relative .png path');
    rmSync(root, { recursive: true, force: true });

    root = repoWith({ glyphArea: 1.2 });
    expect(() => readAppArt(root)).toThrow('"glyphArea" must be a number');
    rmSync(root, { recursive: true, force: true });

    root = repoWith({ glyphAreas: 0.6 });
    expect(() => readAppArt(root)).toThrow('unknown key "glyphAreas"');
  });
});
