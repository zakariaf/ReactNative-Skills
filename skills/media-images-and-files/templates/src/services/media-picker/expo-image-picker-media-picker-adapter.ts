// src/services/media-picker/expo-image-picker-media-picker-adapter.ts: MediaPickerPort over expo-image-picker (devices only).
// device-only: covered by the media drill on a named iOS simulator (picking; capture answers camera-unavailable there) and Android emulator (picking and capture) (references/testing-and-checker.md); the API was read in expo-image-picker 57.0.20 types and native sources, and fake-media-picker.ts runs the same contract in Jest.
import {
  getPendingResultAsync,
  launchCameraAsync,
  launchImageLibraryAsync,
} from 'expo-image-picker';

import { MEDIA_LIMITS } from '@/core/media/image-fit';
import { attemptAsync, err, ok } from '@/core/result';

import type { Result } from '@/core/result';
import type {
  MediaPickFailure,
  MediaPickerPort,
  PickedImage,
} from '@/services/media-picker/media-picker-port';
import type {
  ImagePickerAsset,
  ImagePickerErrorResult,
  ImagePickerOptions,
  ImagePickerResult,
} from 'expo-image-picker';

/**
 * Images only; quality 1 so the picker does not compress (the resizer encodes once); no EXIF (it
 * can hold the place a photo was taken) and no base64 (a 12 MP photo is a 4 to 8 MB string in JS).
 */
const BASE_OPTIONS = {
  mediaTypes: ['images'],
  quality: 1,
  exif: false,
  base64: false,
} as const satisfies ImagePickerOptions;

const PICK_FAILED: MediaPickFailure = { kind: 'pick-failed' };

function toPickedImage(asset: ImagePickerAsset): PickedImage {
  return {
    uri: asset.uri,
    size: { width: asset.width, height: asset.height },
    mimeType: asset.mimeType ?? null,
    sizeBytes: asset.fileSize ?? null,
  };
}

/** Images of a finished pick; a cancel is an empty list. A video or live photo is left out. */
function imagesOf(result: ImagePickerResult): readonly PickedImage[] {
  if (result.canceled) return [];
  return result.assets
    .filter((asset) => asset.type !== 'video' && asset.type !== 'pairedVideo')
    .map(toPickedImage);
}

function isErrorResult(
  result: ImagePickerResult | ImagePickerErrorResult,
): result is ImagePickerErrorResult {
  return 'code' in result;
}

export type MediaPickerAdapterOptions = {
  /**
   * Reads the camera permission without asking (never shows a dialog, never rejects). The
   * composition root binds it to the permission gate's access, so this file imports no permission
   * function: `async () => isPermissionAllowed(await permissions.access.camera.permission())`
   * (permissions-and-system-prompts' PermissionsPort and src/core/permissions/permission-state).
   */
  readonly isCameraAllowed: () => Promise<boolean>;
  /**
   * False where no camera exists. The composition root binds it to
   * `() => Platform.OS !== 'ios' || Device.isDevice` (expo-device): the iOS simulator has no camera,
   * the Android emulator has a virtual one. expo-image-picker 57 sets the camera source without
   * checking that it exists, and UIKit raises an Objective-C exception for it (a crash, not a
   * rejected promise), so this check runs before launchCameraAsync.
   */
  readonly isCameraPresent: () => boolean;
};

async function capture({
  isCameraAllowed,
  isCameraPresent,
}: MediaPickerAdapterOptions): Promise<Result<PickedImage | null, MediaPickFailure>> {
  if (!isCameraPresent()) return err({ kind: 'camera-unavailable' });
  // iOS rejects launchCameraAsync without the permission, and Android would show the system dialog
  // with no explanation: the permission gate runs first, so here a missing grant is a value.
  const allowed = await attemptAsync(isCameraAllowed, () => null);
  if (!allowed.ok || !allowed.value) return err({ kind: 'permission-needed' });
  const result = await attemptAsync(
    () => launchCameraAsync(BASE_OPTIONS),
    (): MediaPickFailure => ({ kind: 'camera-unavailable' }),
  );
  if (!result.ok) return result;
  return ok(imagesOf(result.value)[0] ?? null);
}

export function createExpoImagePickerMediaPickerAdapter(
  options: MediaPickerAdapterOptions,
): MediaPickerPort {
  return {
    pickImages: async ({ limit }) => {
      const selectionLimit = Math.max(1, Math.min(limit, MEDIA_LIMITS.maxPickCount));
      const result = await attemptAsync(
        () =>
          launchImageLibraryAsync({
            ...BASE_OPTIONS,
            allowsMultipleSelection: selectionLimit > 1,
            selectionLimit,
            orderedSelection: true,
          }),
        () => PICK_FAILED,
      );
      return result.ok ? ok(imagesOf(result.value).slice(0, selectionLimit)) : result;
    },
    capturePhoto: () => capture(options),
    recoverPendingPick: async () => {
      const pending = await attemptAsync(getPendingResultAsync, () => PICK_FAILED);
      if (!pending.ok) return pending;
      if (pending.value === null) return ok([]);
      return isErrorResult(pending.value) ? err(PICK_FAILED) : ok(imagesOf(pending.value));
    },
  };
}
