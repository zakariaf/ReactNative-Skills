// src/services/media-store/media-store-port.ts: the app's own media folder: files kept for good, named by MediaRef, resolved to a URI only when shown.
import type { MediaRef } from '@/core/media/media-ref';
import type { Result } from '@/core/result';

export type MediaStoreFailure =
  | { readonly kind: 'no-space'; readonly neededBytes: number; readonly availableBytes: number }
  /** A file with this name exists: names are never reused, so this is a bug in the caller. */
  | { readonly kind: 'name-taken'; readonly ref: MediaRef }
  /** The temporary file to import is gone (the system purged the cache). */
  | { readonly kind: 'source-missing' }
  | { readonly kind: 'write-failed' }
  | { readonly kind: 'delete-failed' }
  | { readonly kind: 'list-failed' };

export type ImportFileRequest = {
  /** A file:// URI of a temporary (a downscaled copy in the cache). */
  readonly sourceUri: string;
  /** A new name (createMediaRef with a new id). */
  readonly ref: MediaRef;
};

/**
 * Adapter: expo-file-system-media-store-adapter.ts (devices). Fake: fake-media-store.ts.
 * The folder lives in the documents folder (kept, included in device backups), never in the cache.
 * Expected failures are Result values; no method throws or rejects.
 */
export type MediaStorePort = {
  /**
   * Copies the temporary into the media folder under `ref`: a partial file first, moved into place
   * when complete, so no half-written file ever carries a name a record could hold. Never
   * overwrites: an existing name is `name-taken`. The temporary is left for discardTemporary.
   */
  readonly importFile: (request: ImportFileRequest) => Promise<Result<MediaRef, MediaStoreFailure>>;
  /** The URI to show `ref` with, computed now from the current folder. Never store it. */
  readonly uriOf: (ref: MediaRef) => string;
  readonly exists: (ref: MediaRef) => boolean;
  /** Deletes the file; a file that is already gone is fine (ok). */
  readonly remove: (ref: MediaRef) => Result<void, MediaStoreFailure>;
  /** Every stored file (partial files left out), for the orphan sweep. */
  readonly list: () => Result<readonly MediaRef[], MediaStoreFailure>;
  /**
   * Deletes the partial files a crash or a kill left in the media folder mid-copy (never one this
   * process is still writing) and answers how many went. list() never shows them, so without this
   * they would stay for good. The orphan sweep calls it.
   */
  readonly removeStalePartials: () => Result<number, MediaStoreFailure>;
  /**
   * Deletes a temporary the picker or the resizer left in the cache. A URI outside the cache folder
   * is never touched, so a stored file or the person's original can never be deleted through here.
   */
  readonly discardTemporary: (uri: string) => void;
};
