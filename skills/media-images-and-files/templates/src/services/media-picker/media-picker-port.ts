// src/services/media-picker/media-picker-port.ts: choosing photos from the library and taking one with the system camera.
import type { PixelSize } from '@/core/media/image-fit';
import type { Result } from '@/core/result';

/**
 * One picked or captured image. The file is a temporary in the cache (the picker's own folder):
 * the system may purge it, so it is downscaled and copied into the media store before anything
 * references it, and then discarded.
 */
export type PickedImage = {
  /** A file:// URI in the cache. Never stored. */
  readonly uri: string;
  /** In pixels; 0 when the system did not report it. */
  readonly size: PixelSize;
  /** What the platform reported (image/jpeg, image/heic, ...), or null. */
  readonly mimeType: string | null;
  /** Bytes on disk, or null when the platform did not report it. */
  readonly sizeBytes: number | null;
};

export type MediaPickFailure =
  /** The camera permission is not granted: run the permission gate first (nothing asks here). */
  | { readonly kind: 'permission-needed' }
  /**
   * This device has no camera (the iOS simulator: the adapter answers this before launching, because
   * UIKit raises an exception for a missing camera instead of rejecting), or the camera UI failed.
   */
  | { readonly kind: 'camera-unavailable' }
  | { readonly kind: 'pick-failed' };

export type PickImagesRequest = {
  /** At most this many images (1 for a single pick); MEDIA_LIMITS.maxPickCount caps it. */
  readonly limit: number;
};

/**
 * Adapter: expo-image-picker-media-picker-adapter.ts (devices). Fake: fake-media-picker.ts.
 * Called only from a person's press. A cancel is an empty list (or null), not a failure.
 * Nothing here asks for a permission: the photo library picker needs none on iOS 14+ and Android,
 * and the camera is opened only after the permission gate allowed it. The adapter reads the state
 * through the gate's access (injected), never through expo-image-picker's permission functions.
 */
export type MediaPickerPort = {
  /** Images only, no EXIF, no base64, in the order the person chose them. */
  readonly pickImages: (
    request: PickImagesRequest,
  ) => Promise<Result<readonly PickedImage[], MediaPickFailure>>;
  /** One photo from the system camera UI; null when the person cancelled. */
  readonly capturePhoto: () => Promise<Result<PickedImage | null, MediaPickFailure>>;
  /**
   * Android: the result of a pick whose activity the system destroyed while the picker was open
   * (an empty list when there is none; always empty on iOS). Called once at startup.
   */
  readonly recoverPendingPick: () => Promise<Result<readonly PickedImage[], MediaPickFailure>>;
};
