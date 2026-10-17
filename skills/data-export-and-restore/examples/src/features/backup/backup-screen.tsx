// src/features/backup/backup-screen.tsx: the Backup screen as a pure view of its model: the confirmation names the policy and the counts.
// A shape to imitate: the app's own copy uses its design system's buttons and dialog. Every word
// arrives translated from the model (screen-contracts: a view never calls t() or renders <T>).
import { View } from 'react-native';

import { AppText } from '@/ui/app-text';

import { BackupAction } from './components/backup-action';
import { RestoreConfirmation } from './components/restore-confirmation';

import type { BackupModel } from './use-backup-model';

export type BackupScreenProps = { readonly model: BackupModel };

export function BackupScreen({ model }: BackupScreenProps): React.JSX.Element {
  const { copy, confirmationCopy, isReducedMotion } = model;
  return (
    <View>
      {/* Each share action measures itself: the iPad popover points at the one pressed. */}
      <BackupAction
        testID="backup.export"
        label={copy.exportLabel}
        onPress={model.onExportBackup}
        isReducedMotion={isReducedMotion}
      />
      <BackupAction
        testID="backup.export-csv"
        label={copy.exportCsvLabel}
        onPress={model.onExportCsv}
        isReducedMotion={isReducedMotion}
      />
      <BackupAction
        testID="backup.restore"
        label={copy.restoreLabel}
        onPress={model.onPickRestoreFile}
        isReducedMotion={isReducedMotion}
      />
      {/* No picker reaches the private folder: the undo of the last restore is offered here. */}
      <BackupAction
        testID="backup.restore-safety-copy"
        label={copy.safetyCopyLabel}
        onPress={model.onPreviewSafetyCopy}
        isReducedMotion={isReducedMotion}
      />
      {copy.notice === null ? null : <AppText>{copy.notice}</AppText>}
      {confirmationCopy === null ? null : (
        <RestoreConfirmation
          copy={confirmationCopy}
          onReplace={model.onConfirmRestore}
          onCancel={model.onCancel}
          isReducedMotion={isReducedMotion}
        />
      )}
    </View>
  );
}
