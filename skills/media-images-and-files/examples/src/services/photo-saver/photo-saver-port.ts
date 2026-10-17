// src/services/photo-saver/photo-saver-port.ts: saving one stored image into the person's photo library (Photos on iOS, the gallery on Android).
import type { Result } from '@/core/result';

export type PhotoSaveFailure =
  /** Add-only (write-only) photo access is not granted: run the permission gate first. */
  { readonly kind: 'permission-needed' } | { readonly kind: 'save-failed' };

/**
 * Adapter: expo-media-library-photo-saver-adapter.ts. Called only from a press ("Save to Photos"),
 * from the photos-add gate's onAllowed.
 * The gate asks for add-only access (expo-media-library requestPermissionsAsync(true)); this port
 * never asks.
 */
export type PhotoSaverPort = {
  /** `uri`: MediaStorePort.uriOf(ref) of a stored file. */
  readonly saveImage: (uri: string) => Promise<Result<'saved', PhotoSaveFailure>>;
};
