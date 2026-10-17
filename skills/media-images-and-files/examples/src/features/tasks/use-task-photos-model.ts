// src/features/tasks/use-task-photos-model.ts: the photos of one task: add from the library or the camera, remove, share (a shape to imitate).
// It assumes the composition root added five members to Services: mediaImporter (createMediaImporter over
// the picker, resizer and store adapters; the picker adapter's isCameraAllowed reads
// permissions.access.camera and its isCameraPresent is false on the iOS simulator), mediaStore, permissions (permissions-and-system-prompts' PermissionsPort with
// a 'camera' kind), shareSheet (data-export-and-restore's ShareSheetPort) and the canonical errorLog. The
// task record holds MediaRefs; `savePhotos` persists, then publishes.
// The camera goes through permissions-and-system-prompts' usePermissionGate: "Take photo" calls
// requestAccess, and the capture job runs only from its onAllowed. The screen renders that skill's
// permission sheet view for `cameraSheet` (explain, Android's rationale with "Continue" / "No thanks",
// settings, unavailable) and wires its buttons to onCameraContinue, onCameraDismiss and onOpenSettings.
import { useRef, useState } from 'react';

import { MEDIA_LIMITS } from '@/core/media/image-fit';
import { usePermissionGate } from '@/hooks/use-permission-gate';
import { useT } from '@/i18n/t-context';
import { useServices } from '@/services/services-context';

import { addFromLibraryJob, removeJob, shareJob, takePhotoJob } from './task-photos-jobs';

import type { TaskPhotosContext, TaskPhotosPhase } from './task-photos-jobs';
import type { MediaRef } from '@/core/media/media-ref';
import type { PermissionGate, PermissionSheet } from '@/hooks/use-permission-gate';

export type TaskPhotoView = {
  readonly ref: MediaRef;
  /** Resolved now with MediaStorePort.uriOf, never stored. */
  readonly uri: string;
  readonly label: string;
};

export type TaskPhotosModel = {
  readonly photos: readonly TaskPhotoView[];
  readonly phase: TaskPhotosPhase;
  readonly canAdd: boolean;
  /** The camera gate's own sheet on screen, or null. */
  readonly cameraSheet: PermissionSheet;
  /** Blocked: the screen says camera access is off and offers the Settings app. */
  readonly isCameraOff: boolean;
  readonly onAddFromLibrary: () => void;
  readonly onTakePhoto: () => void;
  readonly onCameraContinue: () => void;
  readonly onCameraDismiss: () => void;
  readonly onOpenSettings: () => void;
  readonly onRemove: (ref: MediaRef) => void;
  readonly onShare: (ref: MediaRef) => void;
};

type Exclusive = (job: () => Promise<void>) => void;

/** One job at a time, the busy state first; a rejection is recorded and shown, never swallowed. */
function useExclusive(context: TaskPhotosContext, record: (error: unknown) => void): Exclusive {
  const isRunning = useRef(false);
  return (job) => {
    if (isRunning.current) return;
    isRunning.current = true;
    context.setPhase({ kind: 'working' });
    job()
      .finally(() => {
        isRunning.current = false;
      })
      .catch((thrown: unknown) => {
        record(thrown);
        context.setPhase({ kind: 'failed', message: context.t('tasks.photos.save-failed') });
      });
  };
}

function photoViews(context: TaskPhotosContext): readonly TaskPhotoView[] {
  const count = context.photos.length;
  return context.photos.map((ref, index) => ({
    ref,
    uri: context.store.uriOf(ref),
    label: context.t('tasks.photos.photo-label', { position: index + 1, count }),
  }));
}

/** The camera part of the model: the gate's sheet and state, and the capture behind its onAllowed. */
function cameraMembers(
  camera: PermissionGate,
  startCapture: () => void,
): Pick<
  TaskPhotosModel,
  | 'cameraSheet'
  | 'isCameraOff'
  | 'onTakePhoto'
  | 'onCameraContinue'
  | 'onCameraDismiss'
  | 'onOpenSettings'
> {
  return {
    cameraSheet: camera.sheet,
    isCameraOff: camera.state === 'blocked',
    onTakePhoto: () => {
      camera.requestAccess(startCapture);
    },
    onCameraContinue: camera.confirm,
    onCameraDismiss: camera.dismiss,
    onOpenSettings: camera.openSettings,
  };
}

/** The context every job shares: the task's photos, the ports, the phase setter, the translator. */
function useJobContext(
  input: Pick<TaskPhotosContext, 'photos' | 'savePhotos'>,
  setPhase: (phase: TaskPhotosPhase) => void,
): TaskPhotosContext {
  const t = useT();
  const services = useServices();
  return {
    ...input,
    importer: services.mediaImporter,
    store: services.mediaStore,
    shareSheet: services.shareSheet,
    setPhase,
    t,
  };
}

export function useTaskPhotosModel(
  input: Pick<TaskPhotosContext, 'photos' | 'savePhotos'>,
): TaskPhotosModel {
  const services = useServices();
  const [phase, setPhase] = useState<TaskPhotosPhase>({ kind: 'idle' });
  const context = useJobContext(input, setPhase);
  const record = (error: unknown): void => {
    services.errorLog.record('service', error);
  };
  const exclusive = useExclusive(context, record);
  const camera = usePermissionGate({
    access: services.permissions.access.camera,
    openSettings: services.permissions.openSettings,
    // The camera entry of contracts/permissions.json: "Take photo" says what the camera is for, so no
    // explain sheet comes first. Keep it a literal: check-permissions compares it with the contract.
    shouldExplainFirst: false,
    onError: record,
  });
  return {
    photos: photoViews(context),
    phase,
    canAdd:
      phase.kind !== 'working' &&
      !camera.isAsking &&
      input.photos.length < MEDIA_LIMITS.maxPickCount,
    ...cameraMembers(camera, () => {
      exclusive(() => takePhotoJob(context));
    }),
    onAddFromLibrary: () => {
      exclusive(() => addFromLibraryJob(context));
    },
    onRemove: (ref) => {
      exclusive(() => removeJob(context, ref));
    },
    onShare: (ref) => {
      exclusive(() => shareJob(context, ref));
    },
  };
}
