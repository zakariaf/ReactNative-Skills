// src/services/permissions/expo-permission-access.ts
// Maps the answer of any Expo permission function (expo-image-picker, expo-camera, expo-location,
// expo-media-library, expo-contacts, expo-calendar, expo-audio, ...) to the app's PermissionState,
// and wraps a module's get/request pair as a PermissionAccess that never rejects. Every Expo module
// answers with expo-modules-core's PermissionResponse (status, granted, canAskAgain, expires) plus a
// few module fields; the mapping reads canAskAgain, because 'denied' alone cannot tell a refusal the
// OS may ask about again from one only the Settings app can undo.
import { PermissionStatus } from 'expo';

import type { PermissionState } from '@/core/permissions/permission-state';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { PermissionAccess } from '@/services/permissions/permissions-port';
import type { PermissionResponse } from 'expo';

/**
 * PermissionResponse with the optional fields some modules add: `accessPrivileges` (expo-image-picker
 * and expo-media-library: 'limited' on iOS 14+ "Select Photos" and Android 14+ partial access) and
 * the location accuracy (expo-location: iOS 'reduced', Android 'coarse' for approximate location).
 */
export type ExpoPermissionResponse = PermissionResponse & {
  readonly accessPrivileges?: 'all' | 'limited' | 'none';
  readonly ios?: { readonly accuracy?: 'full' | 'reduced' };
  readonly android?: { readonly accuracy?: 'fine' | 'coarse' | 'none' };
};

function isPartial(response: ExpoPermissionResponse): boolean {
  return (
    response.accessPrivileges === 'limited' ||
    response.ios?.accuracy === 'reduced' ||
    response.android?.accuracy === 'coarse'
  );
}

/**
 * The OS answer as the app's state. Expo reports a refusal as 'denied' with canAskAgain false once
 * the dialog can no longer appear: iOS after any refusal, Android after the second one (Expo records
 * it when shouldShowRequestPermissionRationale turns false; expo-modules-core 57, read in source).
 */
export function toPermissionState(response: ExpoPermissionResponse): PermissionState {
  if (response.granted) return isPartial(response) ? 'limited' : 'granted';
  if (response.status === PermissionStatus.UNDETERMINED) return 'undetermined';
  return response.canAskAgain ? 'denied' : 'blocked';
}

export type ExpoPermissionAccessOptions = {
  /** The module's read function, for example ImagePicker.getCameraPermissionsAsync. */
  readonly read: () => Promise<ExpoPermissionResponse>;
  /** The module's request function, for example ImagePicker.requestCameraPermissionsAsync. */
  readonly request: () => Promise<ExpoPermissionResponse>;
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
};

/**
 * A PermissionAccess over one Expo get/request pair. A thrown read or request (a missing purpose
 * string, a module missing from the build, Android's "Another permissions request is in progress")
 * is recorded and answers 'unavailable', so no caller ever handles a rejection.
 */
export function createExpoPermissionAccess(options: ExpoPermissionAccessOptions): PermissionAccess {
  const answer = async (call: () => Promise<ExpoPermissionResponse>): Promise<PermissionState> => {
    try {
      return toPermissionState(await call());
    } catch (error) {
      options.errorLog.record('service', error);
      return 'unavailable';
    }
  };
  return {
    permission: () => answer(options.read),
    requestPermission: () => answer(options.request),
  };
}
