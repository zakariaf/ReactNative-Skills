// src/features/backup/components/restore-confirmation.tsx: the restore confirmation: the policy word, both counts, the date, Replace and Cancel.
// A shape to imitate: the app's own copy uses its design system's dialog. The model words the
// question (use-backup-model.ts lists the messages); this view only lays it out.
import { View } from 'react-native';

import { AppText } from '@/ui/app-text';

import { BackupAction } from './backup-action';

import type { RestoreConfirmationCopy } from '@/features/backup/use-backup-model';

export type RestoreConfirmationProps = {
  readonly copy: RestoreConfirmationCopy;
  readonly onReplace: () => void;
  readonly onCancel: () => void;
  readonly isReducedMotion: boolean;
};

/** Replace is the destructive action and never the default focus; a second tap does nothing. */
export function RestoreConfirmation(props: RestoreConfirmationProps): React.JSX.Element {
  const { copy } = props;
  return (
    <View testID="backup.confirm">
      <AppText>{copy.question}</AppText>
      {copy.unreadableRows === null ? null : <AppText>{copy.unreadableRows}</AppText>}
      <BackupAction
        testID="backup.confirm.replace"
        label={copy.replaceLabel}
        onPress={props.onReplace}
        isReducedMotion={props.isReducedMotion}
      />
      <BackupAction
        testID="backup.confirm.cancel"
        label={copy.cancelLabel}
        onPress={props.onCancel}
        isReducedMotion={props.isReducedMotion}
      />
    </View>
  );
}
