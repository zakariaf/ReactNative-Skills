// src/services/permissions/camera-permission-adapter.ts
// device-only: covered by the use-permission-gate and task-photo model tests through the fake, and
// by the camera permission E2E flow on a named simulator and emulator.
// The camera permission through expo-image-picker (the module that also opens the camera to attach a
// photo to a task). This file is the only importer of its permission functions; the mapping, the
// canAskAgain rule and the never-reject contract come from expo-permission-access.ts. iOS needs
// NSCameraUsageDescription (the plugin's cameraPermission option, read from the catalogs), Android
// android.permission.CAMERA (expo-image-picker declares it; cameraPermission: false would block it).
import { getCameraPermissionsAsync, requestCameraPermissionsAsync } from 'expo-image-picker';

import { createExpoPermissionAccess } from '@/services/permissions/expo-permission-access';

import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { PermissionAccess } from '@/services/permissions/permissions-port';

export type CameraPermissionAdapterOptions = {
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
};

/** services.permissions.access.camera. */
export function createCameraPermissionAdapter(
  options: CameraPermissionAdapterOptions,
): PermissionAccess {
  return createExpoPermissionAccess({
    read: getCameraPermissionsAsync,
    request: requestCameraPermissionsAsync,
    errorLog: options.errorLog,
  });
}
