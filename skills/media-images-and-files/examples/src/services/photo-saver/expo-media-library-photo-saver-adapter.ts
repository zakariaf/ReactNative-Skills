// src/services/photo-saver/expo-media-library-photo-saver-adapter.ts: PhotoSaverPort over expo-media-library's object API (devices only).
// device-only: covered by the media drill (references/testing-and-checker.md); read in expo-media-library 57.0.5 types and Android sources (type-checked against them on 2026-10-14).
// An example: `npx expo install expo-media-library` (~57.0.5). A save-only app lists the plugin as
// ['expo-media-library', { savePhotosPermission: <catalog text>, photosPermission: false, granularPermissions: [] }]
// and blocks READ_MEDIA_IMAGES, READ_MEDIA_VIDEO, READ_MEDIA_AUDIO and READ_MEDIA_VISUAL_USER_SELECTED in
// android.blockedPermissions: saving needs no read access (Android 10+ inserts into MediaStore without a
// permission; WRITE_EXTERNAL_STORAGE matters only on Android 9 and lower), and Google Play's Photo and Video
// Permissions policy allows READ_MEDIA_IMAGES/VIDEO only for apps whose core feature reads the library.
// Verify the merged AndroidManifest.xml and Info.plist after prebuild (references/sharing-and-transfer.md).
// SDK 57: saveToLibraryAsync and createAssetAsync from the main entry throw at runtime; Asset.create replaces them.
import { Asset } from 'expo-media-library';

import { attemptAsync, err } from '@/core/result';

import type { PhotoSaveFailure, PhotoSaverPort } from '@/services/photo-saver/photo-saver-port';

export type PhotoSaverAdapterOptions = {
  /**
   * Reads the add-only photo permission without asking: the composition root binds it to the gate's
   * access for the 'photos-add' kind (permissions-and-system-prompts), so this file imports no
   * permission function: `async () => isPermissionAllowed(await permissions.access['photos-add'].permission())`.
   */
  readonly isAddAllowed: () => Promise<boolean>;
};

export function createExpoMediaLibraryPhotoSaverAdapter({
  isAddAllowed,
}: PhotoSaverAdapterOptions): PhotoSaverPort {
  return {
    saveImage: async (uri) => {
      const allowed = await attemptAsync(isAddAllowed, () => null);
      if (!allowed.ok || !allowed.value) return err({ kind: 'permission-needed' });
      return attemptAsync(
        async () => {
          await Asset.create(uri);
          return 'saved' as const;
        },
        (): PhotoSaveFailure => ({ kind: 'save-failed' }),
      );
    },
  };
}
