// src/features/lists/delete-list-dialog/delete-list-dialog.tsx
// The delete-list dialog (contracts/screens.json, screen "delete-list-dialog", presentation "dialog"):
// a pure view the Lists screen renders while its model holds a pending delete. It is drawn in React
// Native's Modal, which keeps VoiceOver and TalkBack inside the dialog (a View drawn over the screen
// lets both wander onto the list behind it), and onRequestClose closes it on Android's back button
// and predictive back gesture. The scrim covers the status and navigation bars under Android's edge
// to edge. The card and its two actions are drawn here only because the template must compile in a
// reference app without ui-component-library's components; an app with the library composes Scrim,
// DialogCard and Button instead (the same lessons, solved once, and its primaryAction policy then
// matches the real primary).
import { Modal, StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { CONTENT_MAX_WIDTH, RADII, SPACING } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { AppText } from '@/ui/app-text';
import { PressableSurface } from '@/ui/pressable-surface';

export type DeleteListDialogProps = {
  /** Translated: "Delete Groceries?". */
  readonly title: string;
  /** Translated. */
  readonly body: string;
  /** Translated. */
  readonly confirmLabel: string;
  /** Translated. */
  readonly cancelLabel: string;
  readonly onConfirm: () => void;
  /** Cancel, Android back and the predictive back gesture all close the dialog. */
  readonly onCancel: () => void;
  readonly isReducedMotion: boolean;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    scrim: {
      flex: 1,
      justifyContent: 'center',
      paddingInline: SPACING.xl,
      backgroundColor: theme.colors.scrim,
    },
    card: {
      width: '100%',
      maxWidth: CONTENT_MAX_WIDTH,
      alignSelf: 'center',
      gap: SPACING.md,
      padding: SPACING.xl,
      borderRadius: RADII.lg,
      backgroundColor: theme.colors.surface,
    },
    // The two actions wrap onto two lines at large text instead of clipping.
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'flex-end',
      gap: SPACING.sm,
    },
    face: { paddingBlock: SPACING.sm, paddingInline: SPACING.lg, alignItems: 'center' },
  });
  return styles;
});

export function DeleteListDialog(props: DeleteListDialogProps): React.JSX.Element {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <Modal
      visible
      transparent
      animationType={props.isReducedMotion ? 'none' : 'fade'}
      onRequestClose={props.onCancel}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View testID="delete-list-dialog.scrim" style={styles.scrim} accessibilityViewIsModal>
        <View testID="delete-list-dialog.card" style={styles.card}>
          <AppText testID="delete-list-dialog.title" variant="title" isHeader>
            {props.title}
          </AppText>
          <AppText testID="delete-list-dialog.body" tone="muted">
            {props.body}
          </AppText>
          <View style={styles.actions}>
            <PressableSurface
              testID="delete-list-dialog.cancel-button"
              label={props.cancelLabel}
              onPress={props.onCancel}
              radius={RADII.md}
              fill={theme.colors.surface}
              isReducedMotion={props.isReducedMotion}
              accessibilityRole="button"
              faceStyle={styles.face}
            >
              <AppText variant="label">{props.cancelLabel}</AppText>
            </PressableSurface>
            <PressableSurface
              testID="delete-list-dialog.confirm-button"
              label={props.confirmLabel}
              onPress={props.onConfirm}
              radius={RADII.md}
              fill={theme.colors.dangerSurface}
              isReducedMotion={props.isReducedMotion}
              accessibilityRole="button"
              faceStyle={styles.face}
            >
              <AppText tone="danger" variant="label">
                {props.confirmLabel}
              </AppText>
            </PressableSurface>
          </View>
        </View>
      </View>
    </Modal>
  );
}
