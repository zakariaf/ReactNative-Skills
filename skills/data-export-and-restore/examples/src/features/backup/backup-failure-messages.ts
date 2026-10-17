// src/features/backup/backup-failure-messages.ts: one message per export and restore failure kind (exhaustive), so the user can tell a wrong file from lost data.
// A shape to imitate: the keys go into the app's catalogs (en.json, ar.json, ...) with the values below.
import type { ExportFailure, RestoreFailure } from '@/data/backup/backup-failures';
import type { MessageKey } from '@/i18n/messages';

/**
 * en values, for the catalog:
 *   backup.restore.unreadable    "The file could not be opened. If it is in a cloud folder, download it first."
 *   backup.restore.too-large     "This file is too large to be a backup of this app."
 *   backup.restore.not-a-backup  "This file is not a backup. A CSV export cannot be restored."
 *   backup.restore.damaged       "This backup is damaged or was edited, so it cannot be restored."
 *   backup.restore.update-app    "This backup comes from a newer version. Update the app, then restore it."
 *   backup.restore.too-old       "This backup is too old for this version of the app."
 *   backup.restore.invalid       "Part of this backup cannot be read, so nothing was restored."
 *   backup.restore.in-memory     "Your data could not be opened, so a restore would not be kept. Restart the app first."
 *   backup.restore.copy-failed   "Your current data could not be saved first, so nothing was replaced."
 *   backup.restore.already-done  "This backup was already restored."
 *   backup.restore.storage       "Restoring failed and was undone. Your data is unchanged."
 */
export function restoreFailureMessage(failure: RestoreFailure): MessageKey {
  switch (failure.kind) {
    case 'unreadable':
      return 'backup.restore.unreadable';
    case 'too-large':
      return 'backup.restore.too-large';
    case 'not-a-backup':
      return 'backup.restore.not-a-backup';
    case 'damaged':
      return 'backup.restore.damaged';
    case 'newer-format':
    case 'newer-version':
      return 'backup.restore.update-app';
    case 'too-old':
      return 'backup.restore.too-old';
    case 'invalid-row':
    case 'inconsistent':
      return 'backup.restore.invalid';
    case 'session-in-memory':
      return 'backup.restore.in-memory';
    case 'safety-copy-failed':
      return 'backup.restore.copy-failed';
    case 'already-restored':
      return 'backup.restore.already-done';
    case 'storage':
      return 'backup.restore.storage';
  }
}

/**
 * en values, for the catalog:
 *   backup.export.storage       "Your data could not be read, so no file was made."
 *   backup.export.no-space      "There is not enough free space on this device to make the file."
 *   backup.export.write-failed  "The file could not be saved. Try again."
 *   backup.export.too-large     "Your data is too large for one backup file, so none was made."
 *   backup.export.inconsistent  "Some of your data does not fit together, so a backup would not restore. No file was made."
 */
export function exportFailureMessage(failure: ExportFailure): MessageKey {
  switch (failure.kind) {
    case 'storage':
      return 'backup.export.storage';
    case 'no-space':
      return 'backup.export.no-space';
    case 'write-failed':
      return 'backup.export.write-failed';
    case 'too-large':
      return 'backup.export.too-large';
    case 'inconsistent':
      return 'backup.export.inconsistent';
  }
}
