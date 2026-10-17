// scripts/art/app-art-config.ts
// Node world (imported by app.config.ts): the iOS appearance icons and the expo-splash-screen plugin
// entry for the images render-app-art.ts wrote. The paths come from contracts/app-art.json and the
// splash grounds from the palette, so the config, the renderer and check-app-art read one source.
import { readAppArt } from './app-art-contract.ts';
import { PALETTE } from '../../src/theme/palette.ts';

import type { ExpoConfig } from 'expo/config';

type PluginEntry = NonNullable<ExpoConfig['plugins']>[number];
type IosIcon = NonNullable<NonNullable<ExpoConfig['ios']>['icon']>;

/**
 * The splash image (1024 px) is shown imageWidth wide: 200 pt on iOS; on Android 12+ expo-splash-screen
 * centres it at 200 dp on the 288 dp window icon, which Android masks to a 192 dp circle. Keep it at
 * most 288 (check-app-art art-splash-width); the mark's 62 % then stays inside the circle.
 */
export const SPLASH_IMAGE_WIDTH = 200;

/** The Android 12+ splash icon canvas in dp: a wider splash image overflows it. */
export const SPLASH_CANVAS_DP = 288;

/** Expo resolves asset paths against the project root; './' keeps that explicit. */
function relative(path: string): string {
  return `./${path}`;
}

/** `ios.icon` of the production variant: light, dark and tinted appearances (iOS 18 and later). */
export function iosAppearanceIcon(projectRoot: string): IosIcon {
  const { outputs } = readAppArt(projectRoot);
  return {
    light: relative(outputs.light),
    dark: relative(outputs.dark),
    tinted: relative(outputs.tinted),
  };
}

/** The splash: the mark on the palette's background, light and dark. */
export function splashPlugin(projectRoot: string): PluginEntry {
  const { outputs } = readAppArt(projectRoot);
  return [
    'expo-splash-screen',
    {
      image: relative(outputs.splash),
      imageWidth: SPLASH_IMAGE_WIDTH,
      backgroundColor: PALETTE.light.background,
      dark: { image: relative(outputs.splashDark), backgroundColor: PALETTE.dark.background },
    },
  ];
}
