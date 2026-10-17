// scripts/art/load-headless-skia.ts
// The Skia API for plain Node (CanvasKit, no simulator). Draw modules (the brand mark, the icon
// rasterizer's paths) import only TYPES from '@shopify/react-native-skia' and take the Skia API as a
// parameter, so Node's type stripping loads none of React Native.
import headless from '@shopify/react-native-skia/lib/commonjs/headless/index.js';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/commonjs/web/LoadSkiaWeb.js';

export type HeadlessSkia = ReturnType<typeof headless.getSkiaExports>['Skia'];

export async function loadHeadlessSkia(): Promise<HeadlessSkia> {
  await LoadSkiaWeb();
  return headless.getSkiaExports().Skia;
}
