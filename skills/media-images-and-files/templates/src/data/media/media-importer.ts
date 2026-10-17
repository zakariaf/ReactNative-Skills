// src/data/media/media-importer.ts
// The one path from a pick or a capture to a stored file: each picked temporary is downscaled and
// re-encoded once, copied into the media store under a new name, and both temporaries are
// discarded. Images go one at a time (one full-size decode in memory at once), and a batch is all
// or nothing: when one image fails, the files of this batch already stored are removed again.
// Each file joins the importer's session set the moment it is stored and stays there for the life of
// the process (only a batch rollback takes it out), so an orphan sweep never deletes a file of a batch
// still resizing its next image, one between the import and its record save, nor one whose record was
// saved after the sweep read that table. Files abandoned this session are swept at the next launch.
import { MEDIA_LIMITS } from '@/core/media/image-fit';
import { createMediaRef } from '@/core/media/media-ref';
import { err, ok } from '@/core/result';

import type { MediaRef, MediaRefFailure } from '@/core/media/media-ref';
import type { Result } from '@/core/result';
import type { ImageResizerPort, ResizeFailure } from '@/services/image-resizer/image-resizer-port';
import type {
  MediaPickFailure,
  MediaPickerPort,
  PickedImage,
} from '@/services/media-picker/media-picker-port';
import type { MediaStoreFailure, MediaStorePort } from '@/services/media-store/media-store-port';

export type MediaImportFailure =
  MediaPickFailure | ResizeFailure | MediaStoreFailure | MediaRefFailure;

export type MediaImporterDependencies = {
  readonly picker: MediaPickerPort;
  readonly resizer: ImageResizerPort;
  readonly store: MediaStorePort;
  /** A new lowercase id for every stored file (never reused): the composition root provides it. */
  readonly nextMediaId: () => string;
};

export type MediaImporter = {
  /** From a press: pick up to `limit` images and store them. A cancel is an empty list. */
  readonly importFromLibrary: (
    limit: number,
  ) => Promise<Result<readonly MediaRef[], MediaImportFailure>>;
  /** From a press, after the camera permission gate allowed it. A cancel is null. */
  readonly importFromCamera: () => Promise<Result<MediaRef | null, MediaImportFailure>>;
  /** At startup: store the images of a pick Android lost when it destroyed the activity. */
  readonly importPendingPick: () => Promise<Result<readonly MediaRef[], MediaImportFailure>>;
  /**
   * Every ref this importer stored since the app started, rolled-back batches excepted: the orphan
   * sweep keeps them. Never shrunk on a record save: a sweep reads its tables with awaits, and a ref
   * saved to a table it already read would otherwise be in neither list and be deleted.
   */
  readonly sessionRefs: () => ReadonlySet<MediaRef>;
};

type BatchImport = (
  images: readonly PickedImage[],
) => Promise<Result<readonly MediaRef[], MediaImportFailure>>;

/** One picked temporary to one stored file; both temporaries are discarded either way. */
async function importOne(
  { resizer, store, nextMediaId }: MediaImporterDependencies,
  picked: PickedImage,
): Promise<Result<MediaRef, MediaImportFailure>> {
  const ref = createMediaRef(nextMediaId(), 'jpg');
  if (!ref.ok) {
    store.discardTemporary(picked.uri);
    return ref;
  }
  const downscaled = await resizer.downscale({
    uri: picked.uri,
    size: picked.size,
    maxEdgePx: MEDIA_LIMITS.storedMaxEdgePx,
    quality: MEDIA_LIMITS.jpegQuality,
  });
  store.discardTemporary(picked.uri);
  if (!downscaled.ok) return downscaled;
  const stored = await store.importFile({ sourceUri: downscaled.value.uri, ref: ref.value });
  store.discardTemporary(downscaled.value.uri);
  return stored;
}

/** All or nothing, one image at a time; each stored ref joins `sessionRefs` at once. */
function batchImporter(
  dependencies: MediaImporterDependencies,
  sessionRefs: Set<MediaRef>,
): BatchImport {
  const { store } = dependencies;
  return async (images) => {
    const refs: MediaRef[] = [];
    for (const [index, picked] of images.entries()) {
      // One image at a time: a full-size decode is tens of MB, and parallel imports multiply it.
      const stored = await importOne(dependencies, picked);
      if (!stored.ok) {
        for (const ref of refs) {
          store.remove(ref);
          sessionRefs.delete(ref);
        }
        for (const rest of images.slice(index + 1)) store.discardTemporary(rest.uri);
        return err(stored.error);
      }
      // Protected now, not after the batch: a sweep may run while the next image resizes.
      sessionRefs.add(stored.value);
      refs.push(stored.value);
    }
    return ok(refs);
  };
}

export function createMediaImporter(dependencies: MediaImporterDependencies): MediaImporter {
  const { picker } = dependencies;
  const sessionRefs = new Set<MediaRef>();
  const importAll = batchImporter(dependencies, sessionRefs);
  return {
    importFromLibrary: async (limit) => {
      const picked = await picker.pickImages({ limit });
      return picked.ok ? importAll(picked.value) : picked;
    },
    importFromCamera: async () => {
      const captured = await picker.capturePhoto();
      if (!captured.ok) return captured;
      if (captured.value === null) return ok(null);
      const stored = await importAll([captured.value]);
      return stored.ok ? ok(stored.value[0] ?? null) : stored;
    },
    importPendingPick: async () => {
      const pending = await picker.recoverPendingPick();
      return pending.ok ? importAll(pending.value) : pending;
    },
    sessionRefs: () => sessionRefs,
  };
}
