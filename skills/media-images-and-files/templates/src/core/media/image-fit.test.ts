// src/core/media/image-fit.test.ts
import fc from 'fast-check';

import {
  MEDIA_LIMITS,
  decodedBytes,
  fitWithin,
  isKnownSize,
  needsDownscale,
  pixelsForPoints,
} from './image-fit';

describe('fitWithin', () => {
  it('scales a 12 MP photo to the stored long edge, keeping the aspect ratio', () => {
    expect(fitWithin({ width: 4032, height: 3024 }, MEDIA_LIMITS.storedMaxEdgePx)).toStrictEqual({
      width: 2048,
      height: 1536,
    });
    expect(fitWithin({ width: 3024, height: 4032 }, 2048)).toStrictEqual({
      width: 1536,
      height: 2048,
    });
  });

  it('keeps a small image at its own size', () => {
    expect(fitWithin({ width: 640, height: 480 }, 2048)).toStrictEqual({ width: 640, height: 480 });
  });

  it('keeps a very thin panorama at least one pixel high', () => {
    expect(fitWithin({ width: 100_000, height: 10 }, 2048)).toStrictEqual({
      width: 2048,
      height: 1,
    });
  });

  it('gives null for a size the system did not report, or a useless limit', () => {
    expect(fitWithin({ width: 0, height: 3024 }, 2048)).toBeNull();
    expect(fitWithin({ width: 10, height: 10 }, 0)).toBeNull();
  });

  it('keeps every result within the limit, whole, never larger, and within half a pixel of exact (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20_000 }),
        fc.integer({ min: 1, max: 20_000 }),
        fc.integer({ min: 16, max: 4096 }),
        (width, height, maxEdgePx) => {
          const fitted = fitWithin({ width, height }, maxEdgePx);
          if (fitted === null) return false;
          const scale = Math.min(1, maxEdgePx / Math.max(width, height));
          const isClose = (side: number, exact: number): boolean =>
            side === 1 ? exact <= 1.5 : Math.abs(side - exact) <= 0.5;
          return (
            Number.isInteger(fitted.width) &&
            Number.isInteger(fitted.height) &&
            Math.max(fitted.width, fitted.height) <= maxEdgePx &&
            fitted.width <= width &&
            fitted.height <= height &&
            isClose(fitted.width, width * scale) &&
            isClose(fitted.height, height * scale)
          );
        },
      ),
    );
  });
});

describe('sizes and memory', () => {
  it('knows when a size is unknown and when a downscale is needed', () => {
    expect(isKnownSize({ width: 0, height: 0 })).toBe(false);
    expect(needsDownscale({ width: 4032, height: 3024 }, 2048)).toBe(true);
    expect(needsDownscale({ width: 2048, height: 1536 }, 2048)).toBe(false);
    expect(needsDownscale({ width: 0, height: 0 }, 2048)).toBe(false);
  });

  it('prices a decoded bitmap at four bytes per pixel', () => {
    expect(decodedBytes({ width: 4032, height: 3024 })).toBe(48_771_072);
    expect(decodedBytes({ width: 2048, height: 1536 })).toBe(12_582_912);
  });

  it('turns points into pixels for the screen density, rounding up', () => {
    expect(pixelsForPoints({ width: 64, height: 48 }, 3)).toStrictEqual({
      width: 192,
      height: 144,
    });
    expect(pixelsForPoints({ width: 10.2, height: 0 }, 2.625)).toStrictEqual({
      width: 27,
      height: 1,
    });
  });
});
