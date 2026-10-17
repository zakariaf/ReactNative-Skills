// src/services/image-resizer/image-resizer-port.ts: the one re-encode of a picked image before it is stored: downscaled, JPEG, metadata dropped.
import type { PixelSize } from '@/core/media/image-fit';
import type { Result } from '@/core/result';

export type DownscaleRequest = {
  /** A file:// URI of the picked temporary. */
  readonly uri: string;
  /** What the picker reported, in pixels; 0 when unknown (the adapter then reads it). */
  readonly size: PixelSize;
  /** The long edge to fit within (MEDIA_LIMITS.storedMaxEdgePx); a smaller image is not upscaled. */
  readonly maxEdgePx: number;
  /** JPEG quality, 0 to 1 (MEDIA_LIMITS.jpegQuality). */
  readonly quality: number;
};

export type DownscaledImage = {
  /** A new temporary in the cache: import it into the media store, then discard it. */
  readonly uri: string;
  readonly size: PixelSize;
};

export type ResizeFailure = { readonly kind: 'resize-failed' };

/**
 * Adapter: expo-image-manipulator-image-resizer-adapter.ts (the skill's examples/ until
 * expo-image-manipulator is installed). Fake: fake-image-resizer.ts. Every image is re-encoded,
 * even a small one: the output is always a JPEG (HEIC becomes readable everywhere) and the new file
 * carries no EXIF block, so no GPS position leaves the device in a stored or shared photo.
 */
export type ImageResizerPort = {
  readonly downscale: (
    request: DownscaleRequest,
  ) => Promise<Result<DownscaledImage, ResizeFailure>>;
};
