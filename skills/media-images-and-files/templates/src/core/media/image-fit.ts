// src/core/media/image-fit.ts
// Pixel arithmetic for media: the size an image is downscaled to before it is stored, the memory a
// decoded bitmap costs, and the app's media limits. Pure TypeScript, so every rule is a fast test.

/** A size in pixels (not points): what a decoder allocates. */
export type PixelSize = { readonly width: number; readonly height: number };

/**
 * The app's media limits. A 12 MP camera photo (4032 x 3024) decodes to about 49 MB; stored at
 * 2048 px on the long edge it decodes to about 12.6 MB and its JPEG is a few hundred KB.
 */
export const MEDIA_LIMITS = {
  /** The long edge of every stored image, in pixels. */
  storedMaxEdgePx: 2048,
  /** JPEG quality of the one re-encode before storing (0 to 1). */
  jpegQuality: 0.8,
  /** Most images one pick may return. */
  maxPickCount: 10,
} as const;

/** Bytes per decoded pixel (RGBA, 8 bits per channel) on iOS and on Android's default ARGB_8888. */
const BYTES_PER_PIXEL = 4;

/** True when the size is known: pickers report 0 when the system gave no dimensions. */
export function isKnownSize(size: PixelSize): boolean {
  return size.width > 0 && size.height > 0;
}

/**
 * The largest size with the same aspect ratio whose long edge is at most `maxEdgePx`. Never
 * upscales; every side is a whole pixel and at least 1. An unknown size (0) gives null.
 */
export function fitWithin(size: PixelSize, maxEdgePx: number): PixelSize | null {
  if (!isKnownSize(size) || maxEdgePx < 1) return null;
  const longEdge = Math.max(size.width, size.height);
  if (longEdge <= maxEdgePx) return { width: size.width, height: size.height };
  const scale = maxEdgePx / longEdge;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/** True when an image of this size must be downscaled before it is stored. */
export function needsDownscale(size: PixelSize, maxEdgePx: number): boolean {
  return isKnownSize(size) && Math.max(size.width, size.height) > maxEdgePx;
}

/** The memory one decoded bitmap of this size holds, in bytes. */
export function decodedBytes(size: PixelSize): number {
  return size.width * size.height * BYTES_PER_PIXEL;
}

/**
 * The pixel size a view of `points` needs on a screen of `pixelRatio` (PixelRatio.get()): what to
 * request from a server that resizes, or what a thumbnail should hold.
 */
export function pixelsForPoints(points: PixelSize, pixelRatio: number): PixelSize {
  return {
    width: Math.max(1, Math.ceil(points.width * pixelRatio)),
    height: Math.max(1, Math.ceil(points.height * pixelRatio)),
  };
}
