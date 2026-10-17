// src/services/media-store/expo-file-system-media-store-adapter.ts: MediaStorePort over expo-file-system's File, Directory and Paths (devices only).
// device-only: covered by the media drill on a named iOS simulator and Android emulator (references/testing-and-checker.md); the API was read in expo-file-system 57.0.7 types, and fake-media-store.ts runs the same contract in Jest.
import { Directory, File, Paths } from 'expo-file-system';

import { parseMediaRef } from '@/core/media/media-ref';
import { attempt, attemptAsync, err, ok } from '@/core/result';

import type { MediaRef } from '@/core/media/media-ref';
import type { Result } from '@/core/result';
import type { MediaStoreFailure, MediaStorePort } from '@/services/media-store/media-store-port';

/** The media folder's name inside Paths.document. Changing it orphans every stored file. */
const MEDIA_FOLDER = 'media';

/** Bytes kept free beyond the file itself, so an import never fills the disk the database needs. */
const SPACE_MARGIN_BYTES = 5 * 1024 * 1024;

const WRITE_FAILED: MediaStoreFailure = { kind: 'write-failed' };

/** `.<ref>.partial`: a copy not moved into place yet. */
const PARTIAL_NAME = /^\.[^/]+\.partial$/;

const partialNameOf = (ref: MediaRef): string => `.${ref}.partial`;

function mediaFolder(): Directory {
  const directory = new Directory(Paths.document, MEDIA_FOLDER);
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

function withSlash(uri: string): string {
  return uri.endsWith('/') ? uri : `${uri}/`;
}

/** Removes our own partial file (never a published file, never the person's data). */
function discardPartial(partial: File): void {
  attempt(
    () => {
      if (partial.exists) partial.delete();
    },
    () => undefined,
  );
}

type CopyRequest = {
  readonly source: File;
  readonly folder: Directory;
  readonly ref: MediaRef;
  /** Partial names being written now: removeStalePartials leaves them alone. */
  readonly writing: Set<string>;
};

async function copyIntoPlace({
  source,
  folder,
  ref,
  writing,
}: CopyRequest): Promise<Result<MediaRef, MediaStoreFailure>> {
  // The name is kept apart: moveSync points `partial` at the target, so partial.name changes.
  const partialName = partialNameOf(ref);
  const partial = new File(folder, partialName);
  const target = new File(folder, ref);
  discardPartial(partial);
  writing.add(partialName);
  const copied = await attemptAsync(
    async () => {
      await source.copy(partial);
      partial.moveSync(target);
    },
    () => WRITE_FAILED,
  );
  writing.delete(partialName);
  if (!copied.ok) {
    discardPartial(partial);
    return copied;
  }
  return ok(ref);
}

async function importFile(
  { sourceUri, ref }: { readonly sourceUri: string; readonly ref: MediaRef },
  writing: Set<string>,
): Promise<Result<MediaRef, MediaStoreFailure>> {
  const opened = attempt(
    () => {
      const folder = mediaFolder();
      return { folder, source: new File(sourceUri), target: new File(folder, ref) };
    },
    () => WRITE_FAILED,
  );
  if (!opened.ok) return opened;
  const { folder, source, target } = opened.value;
  if (target.exists) return err({ kind: 'name-taken', ref });
  if (!source.exists) return err({ kind: 'source-missing' });
  const neededBytes = source.size + SPACE_MARGIN_BYTES;
  const availableBytes = Paths.availableDiskSpace;
  if (availableBytes < neededBytes) return err({ kind: 'no-space', neededBytes, availableBytes });
  return copyIntoPlace({ source, folder, ref, writing });
}

function listStored(): Result<readonly MediaRef[], MediaStoreFailure> {
  return attempt(
    () =>
      mediaFolder()
        .list()
        .flatMap((entry) => {
          if (!(entry instanceof File)) return [];
          const parsed = parseMediaRef(entry.name);
          return parsed.ok ? [parsed.value] : [];
        }),
    (): MediaStoreFailure => ({ kind: 'list-failed' }),
  );
}

/** Deletes every `.<ref>.partial` that no copy of this process is writing. */
function removeStalePartials(writing: ReadonlySet<string>): Result<number, MediaStoreFailure> {
  return attempt(
    () => {
      const stale = mediaFolder()
        .list()
        .filter(
          (entry): entry is File =>
            entry instanceof File && PARTIAL_NAME.test(entry.name) && !writing.has(entry.name),
        );
      for (const partial of stale) partial.delete();
      return stale.length;
    },
    (): MediaStoreFailure => ({ kind: 'delete-failed' }),
  );
}

export function createExpoFileSystemMediaStoreAdapter(): MediaStorePort {
  const writing = new Set<string>();
  return {
    importFile: (request) => importFile(request, writing),
    uriOf: (ref) => new File(Paths.document, MEDIA_FOLDER, ref).uri,
    exists: (ref) => new File(Paths.document, MEDIA_FOLDER, ref).exists,
    remove: (ref) =>
      attempt(
        () => {
          const file = new File(Paths.document, MEDIA_FOLDER, ref);
          if (file.exists) file.delete();
        },
        (): MediaStoreFailure => ({ kind: 'delete-failed' }),
      ),
    list: listStored,
    removeStalePartials: () => removeStalePartials(writing),
    discardTemporary: (uri) => {
      if (!uri.startsWith(withSlash(Paths.cache.uri))) return;
      attempt(
        () => {
          const file = new File(uri);
          if (file.exists) file.delete();
        },
        () => undefined,
      );
    },
  };
}
