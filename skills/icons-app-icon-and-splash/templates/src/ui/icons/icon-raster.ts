// src/ui/icons/icon-raster.ts
// device-only: covered by icon-raster.golden.test.ts (CanvasKit) and the screens that show icons.
// Rasterizes one icon path with Skia on the CPU into a white PNG at the exact pixel size and keeps
// it as a data: URI (decoded locally: no network). The Icon component tints it with tintColor, so a
// theme change never re-rasterizes.
import { Skia } from '@shopify/react-native-skia';

import { ICON_PATHS } from './icon-paths';

import type { IconName } from './icon-paths';

const GRID = 24;
const cache = new Map<string, string>();
/** Opaque white in Skia's own colour form: a mask, never shown (the Image's tintColor paints it). */
const MASK = Float32Array.of(1, 1, 1, 1);
const fill = Skia.Paint();
fill.setColor(MASK);
fill.setAntiAlias(true);

function rasterize(svgPath: string, px: number): string {
  const surface = Skia.Surface.Make(px, px);
  const path = Skia.Path.MakeFromSVGString(svgPath);
  if (surface === null || path === null) throw new Error('Icon rasterization failed');
  const canvas = surface.getCanvas();
  canvas.scale(px / GRID, px / GRID);
  canvas.drawPath(path, fill);
  surface.flush();
  return `data:image/png;base64,${surface.makeImageSnapshot().encodeToBase64()}`;
}

/** A white PNG per icon and pixel size (size x pixel ratio), cached for the app's lifetime. */
export function getIconUri(name: IconName, sizePt: number, pixelRatio: number): string {
  const px = Math.ceil(sizePt * pixelRatio);
  const key = `${name}@${String(px)}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const uri = rasterize(ICON_PATHS[name], px);
  cache.set(key, uri);
  return uri;
}
