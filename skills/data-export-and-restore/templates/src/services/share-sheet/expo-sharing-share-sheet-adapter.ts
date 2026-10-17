// src/services/share-sheet/expo-sharing-share-sheet-adapter.ts: ShareSheetPort over expo-sharing's shareAsync (devices only).
// device-only: covered by the export-share-restore drill on a named iOS simulator and Android emulator (references/platform-behaviour.md); the API was read in expo-sharing 57.0.22 types and fake-share-sheet.ts runs the contract in Jest.
import { isAvailableAsync, shareAsync } from 'expo-sharing';

import { attemptAsync, err } from '@/core/result';

import type { ShareFailure, ShareSheetPort } from '@/services/share-sheet/share-sheet-port';

export function createExpoSharingShareSheetAdapter(): ShareSheetPort {
  return {
    shareFile: async (request) => {
      const isAvailable = await attemptAsync(isAvailableAsync, () => false);
      if (!isAvailable.ok || !isAvailable.value) return err({ kind: 'unavailable' });
      return attemptAsync(
        async () => {
          await shareAsync(request.uri, {
            mimeType: request.mimeType,
            UTI: request.uti,
            dialogTitle: request.dialogTitle,
            ...(request.anchor === null ? {} : { anchor: request.anchor }),
          });
          return 'sheet-closed' as const;
        },
        (): ShareFailure => ({ kind: 'share-failed' }),
      );
    },
  };
}
