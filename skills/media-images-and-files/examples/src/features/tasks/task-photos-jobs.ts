// src/features/tasks/task-photos-jobs.ts: the work behind each press of the task photos (a shape to imitate).
// Each job returns a promise the model runs through its exclusive runner (one job at a time, the busy
// state painted first, a rejection recorded and shown, never stuck on "working"). Permissions are not
// handled here: the model runs takePhotoJob only from the camera gate's onAllowed
// (permissions-and-system-prompts' usePermissionGate), so the explain sheet, Android's rationale
// sheet and the settings sheet all come from the gate.
import { MEDIA_LIMITS } from '@/core/media/image-fit';
import { mimeTypeOf, utiOf } from '@/core/media/media-ref';

import type { MediaRef } from '@/core/media/media-ref';
import type { MediaImporter, MediaImportFailure } from '@/data/media/media-importer';
import type { TFunction } from '@/i18n/create-t';
import type { MessageKey } from '@/i18n/messages';
import type { MediaStorePort } from '@/services/media-store/media-store-port';
import type { ShareFailure, ShareSheetPort } from '@/services/share-sheet/share-sheet-port';

export type TaskPhotosPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working' }
  | { readonly kind: 'failed'; readonly message: string };

/** What every job may touch. */
export type TaskPhotosContext = {
  readonly photos: readonly MediaRef[];
  /** Persists the task's new photo list (the tasks store action); false when the save failed. */
  readonly savePhotos: (photos: readonly MediaRef[]) => Promise<boolean>;
  readonly importer: MediaImporter;
  readonly store: MediaStorePort;
  readonly shareSheet: ShareSheetPort;
  readonly setPhase: (phase: TaskPhotosPhase) => void;
  readonly t: TFunction;
};

const SAVE_FAILED: MessageKey = 'tasks.photos.save-failed';
const UNREADABLE: MessageKey = 'tasks.photos.unreadable';
const PICK_FAILED: MessageKey = 'tasks.photos.pick-failed';

/** One message per failure kind: the person can tell "no space" from "no camera". */
const FAILURE_MESSAGE_KEYS: Readonly<Record<MediaImportFailure['kind'], MessageKey>> = {
  'permission-needed': 'tasks.photos.camera-needed',
  'camera-unavailable': 'tasks.photos.camera-unavailable',
  'pick-failed': PICK_FAILED,
  'source-missing': PICK_FAILED,
  'resize-failed': UNREADABLE,
  'unsupported-type': UNREADABLE,
  'no-space': 'tasks.photos.no-space',
  'name-taken': SAVE_FAILED,
  'write-failed': SAVE_FAILED,
  'delete-failed': SAVE_FAILED,
  'list-failed': SAVE_FAILED,
  'invalid-id': SAVE_FAILED,
  'invalid-ref': SAVE_FAILED,
};

const SHARE_MESSAGE_KEYS: Readonly<Record<ShareFailure['kind'], MessageKey>> = {
  unavailable: 'tasks.photos.share-unavailable',
  'share-failed': 'tasks.photos.share-failed',
};

function showFailure(context: TaskPhotosContext, failure: MediaImportFailure): void {
  context.setPhase({ kind: 'failed', message: context.t(FAILURE_MESSAGE_KEYS[failure.kind]) });
}

/**
 * Saves the new refs in the record; when that fails the new files go again (no orphans). The importer
 * keeps protecting the refs from the sweep either way (MediaImporter.sessionRefs).
 */
async function keep(context: TaskPhotosContext, added: readonly MediaRef[]): Promise<void> {
  if (added.length === 0) {
    context.setPhase({ kind: 'idle' });
    return;
  }
  const isSaved = await context.savePhotos([...context.photos, ...added]);
  if (!isSaved) for (const ref of added) context.store.remove(ref);
  context.setPhase(
    isSaved ? { kind: 'idle' } : { kind: 'failed', message: context.t(SAVE_FAILED) },
  );
}

export async function addFromLibraryJob(context: TaskPhotosContext): Promise<void> {
  const room = MEDIA_LIMITS.maxPickCount - context.photos.length;
  const imported = await context.importer.importFromLibrary(room);
  if (imported.ok) await keep(context, imported.value);
  else showFailure(context, imported.error);
}

/** Runs from the camera gate's onAllowed only: the permission allowed the capture at this press. */
export async function takePhotoJob(context: TaskPhotosContext): Promise<void> {
  const captured = await context.importer.importFromCamera();
  if (!captured.ok) showFailure(context, captured.error);
  else await keep(context, captured.value === null ? [] : [captured.value]);
}

/** The record first, then the file: a crash in between leaves an orphan the sweep removes. */
export async function removeJob(context: TaskPhotosContext, ref: MediaRef): Promise<void> {
  const isSaved = await context.savePhotos(context.photos.filter((each) => each !== ref));
  if (isSaved) context.store.remove(ref);
  context.setPhase(
    isSaved ? { kind: 'idle' } : { kind: 'failed', message: context.t(SAVE_FAILED) },
  );
}

/** The stored, re-encoded file (no EXIF), with its own type; a failed share says so. */
export async function shareJob(context: TaskPhotosContext, ref: MediaRef): Promise<void> {
  const shared = await context.shareSheet.shareFile({
    uri: context.store.uriOf(ref),
    mimeType: mimeTypeOf(ref),
    uti: utiOf(ref),
    dialogTitle: context.t('tasks.photos.share-title'),
    // iPad: pass the pressed thumbnail's frame (measureInWindow) so the popover points at it.
    anchor: null,
  });
  // 'sheet-closed' says nothing about whether the photo went anywhere: no "Shared" message.
  context.setPhase(
    shared.ok
      ? { kind: 'idle' }
      : { kind: 'failed', message: context.t(SHARE_MESSAGE_KEYS[shared.error.kind]) },
  );
}
