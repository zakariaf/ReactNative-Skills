// src/ui/icons/brand-mark-art.golden.test.ts
// Runs in the 'golden' Jest project (CanvasKit): draws the mark for real and reads its pixels.
import { Skia } from '@shopify/react-native-skia';

import { PALETTE } from '@/theme/palette';

import { drawMark, markOps, monoOps } from './brand-mark-art';

import type { BrandMark } from './brand-mark-art';

const MARK: BrandMark = {
  tile: 'primary',
  layers: [
    { d: 'M8 8h32v32H8z', fill: 'surface' },
    { d: 'M14 24h20', stroke: 'text', width: 6 },
  ],
};
const SIZE = 96;

function pixelsOf(ops: Parameters<typeof drawMark>[2]['ops']): Uint8Array {
  const surface = Skia.Surface.Make(SIZE, SIZE);
  if (surface === null) throw new Error('No surface');
  drawMark(Skia, surface.getCanvas(), { ops, size: SIZE });
  surface.flush();
  return surface.makeImageSnapshot().readPixels() as Uint8Array;
}

/** '#RRGGBB' as the opaque RGBA bytes Skia writes. */
function rgba(hex: string): number[] {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)).concat(255);
}

function pixelAt(pixels: Uint8Array, [x, y]: readonly [number, number]): number[] {
  const at = (y * SIZE + x) * 4;
  return [...pixels.slice(at, at + 4)];
}

describe('drawMark', () => {
  it('scales the 48 grid to the size and paints each layer in its colour', () => {
    const pixels = pixelsOf(markOps(MARK, PALETTE.light));

    expect(pixelAt(pixels, [24, 24])).toStrictEqual(rgba(PALETTE.light.surface));
    expect(pixelAt(pixels, [48, 48])).toStrictEqual(rgba(PALETTE.light.text));
    expect(pixelAt(pixels, [4, 4])[3]).toBe(0);
  });

  it('cuts the lines out of the white silhouette for the monochrome icon', () => {
    const pixels = pixelsOf(monoOps(MARK, '#FFFFFF'));

    expect(pixelAt(pixels, [24, 24])).toStrictEqual([255, 255, 255, 255]);
    expect(pixelAt(pixels, [48, 48])[3]).toBe(0);
  });
});
