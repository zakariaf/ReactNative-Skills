// src/features/task-photo/use-task-photo-model.ts
// Attaching a photo to a task. The camera permission is asked when the person presses "Take photo"
// (the button says what the camera is for, so no explain sheet comes first: shouldExplainFirst
// matches contracts/permissions.json), never at launch and never from an effect. A refusal leaves
// the feature off without nagging; once the permission is blocked, the screen says camera access is
// off and offers the Settings app. In an app whose Services carry the PermissionsPort, the route
// passes services.permissions.access.camera and services.permissions.openSettings.
import { useState } from 'react';

import { usePermissionGate } from '@/hooks/use-permission-gate';

import type { PermissionSheet } from '@/hooks/use-permission-gate';
import type { PermissionAccess } from '@/services/permissions/permissions-port';

export type TaskPhotoDeps = {
  readonly camera: PermissionAccess;
  readonly openSettings: () => Promise<void>;
  /** Opens the camera; resolves with the photo's uri, or null when the person cancelled. */
  readonly takePhoto: () => Promise<string | null>;
  readonly onError: (error: unknown) => void;
};

export type TaskPhotoModel = {
  readonly photoUri: string | null;
  /** The permission sheet to show, or null. */
  readonly sheet: PermissionSheet;
  /** Blocked: show "Camera access is off" with a button to the Settings app. */
  readonly isCameraOff: boolean;
  /** No camera on this device: hide the button. */
  readonly isCameraMissing: boolean;
  readonly isBusy: boolean;
  readonly onTakePhoto: () => void;
  readonly onContinue: () => void;
  readonly onDismiss: () => void;
  readonly onOpenSettings: () => void;
};

export function useTaskPhotoModel(deps: TaskPhotoDeps): TaskPhotoModel {
  const gate = usePermissionGate({
    access: deps.camera,
    openSettings: deps.openSettings,
    shouldExplainFirst: false,
    onError: deps.onError,
  });
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const capture = (): void => {
    deps.takePhoto().then((uri) => {
      if (uri !== null) setPhotoUri(uri);
    }, deps.onError);
  };
  return {
    photoUri,
    sheet: gate.sheet,
    isCameraOff: gate.state === 'blocked',
    isCameraMissing: gate.state === 'unavailable',
    isBusy: gate.isAsking,
    onTakePhoto: () => {
      gate.requestAccess(capture);
    },
    onContinue: gate.confirm,
    onDismiss: gate.dismiss,
    onOpenSettings: gate.openSettings,
  };
}
