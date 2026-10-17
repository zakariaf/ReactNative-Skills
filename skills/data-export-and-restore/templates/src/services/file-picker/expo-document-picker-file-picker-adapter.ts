// src/services/file-picker/expo-document-picker-file-picker-adapter.ts: FilePickerPort over expo-document-picker (devices only).
// device-only: covered by the export-share-restore drill on a named iOS simulator and Android emulator (references/platform-behaviour.md); the API was read in expo-document-picker 57.0.3 types and fake-file-picker.ts runs the contract in Jest.
import { getDocumentAsync } from 'expo-document-picker';

import { attemptAsync, ok } from '@/core/result';

import type {
  FilePickerPort,
  PickedFile,
  PickFailure,
} from '@/services/file-picker/file-picker-port';

/**
 * Every type: providers label the same .json file differently (application/json,
 * application/octet-stream, text/plain); the envelope, not the label, decides what a file is.
 */
const ANY_FILE = '*/*';

export function createExpoDocumentPickerFilePickerAdapter(): FilePickerPort {
  return {
    pickFile: async () => {
      const picked = await attemptAsync(
        // copyToCacheDirectory: the copy is a file:// URI expo-file-system can read right away.
        () => getDocumentAsync({ type: ANY_FILE, copyToCacheDirectory: true, multiple: false }),
        (): PickFailure => ({ kind: 'pick-failed' }),
      );
      if (!picked.ok) return picked;
      const asset = picked.value.canceled ? undefined : picked.value.assets[0];
      if (asset === undefined) return ok(null);
      const file: PickedFile = {
        uri: asset.uri,
        name: asset.name,
        sizeBytes: asset.size ?? null,
        mimeType: asset.mimeType ?? null,
      };
      return ok(file);
    },
  };
}
