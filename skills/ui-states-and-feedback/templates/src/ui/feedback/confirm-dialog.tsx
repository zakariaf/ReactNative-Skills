// src/ui/feedback/confirm-dialog.tsx
import { Modal, Platform, StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { CONTENT_MAX_WIDTH, RADII, SPACING } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { AppText } from '@/ui/app-text';
import { PressableSurface } from '@/ui/pressable-surface';

import { AboveModalScreens } from './above-modal-screens';

import type { ConfirmOutcome, ConfirmRequest } from './confirm';
import type { ReactNode } from 'react';

export type ConfirmDialogProps = {
  /** The scrim's id (the host's, e.g. 'app.confirm'); the card and its parts take the request's testID. */
  readonly testID: string;
  /** The open question, or null when none is open. */
  readonly request: ConfirmRequest | null;
  readonly onAnswer: (outcome: ConfirmOutcome) => void;
  readonly isReducedMotion: boolean;
};

/**
 * The smallest width a button takes before the two wrap onto two rows. The design names no token for
 * it: about 120 points fits "Cancel" and a two-word verb at the default text size, and larger text
 * wraps the row instead of clipping the label.
 */
const BUTTON_MIN_BASIS = 120;

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    scrim: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: SPACING.xl,
      backgroundColor: theme.colors.scrim,
    },
    card: {
      width: '100%',
      maxWidth: CONTENT_MAX_WIDTH,
      gap: SPACING.md,
      padding: SPACING.xl,
      borderRadius: RADII.lg,
      backgroundColor: theme.colors.surface,
    },
    buttons: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: SPACING.sm,
      marginBlockStart: SPACING.sm,
    },
    buttonFace: { paddingBlock: SPACING.md, paddingInline: SPACING.lg, alignItems: 'center' },
    button: { flexGrow: 1, flexBasis: BUTTON_MIN_BASIS },
  });
  return styles;
});

/**
 * The confirmation for an action that cannot be undone. The scrim is the modal root (both screen
 * readers stay inside); a tap on it does nothing, because the question must be answered. Cancel
 * comes first. On Android it is a React Native Modal (its own window): the back button and back
 * gesture answer 'dismissed', never 'confirmed'. On iOS it renders in the overlay window, so it also
 * opens above a modal or form-sheet screen (a Modal hosted in the root cannot be presented while
 * such a screen is up); iOS has no back gesture for it, and it appears without the fade.
 */
export function ConfirmDialog({
  testID,
  request,
  onAnswer,
  isReducedMotion,
}: ConfirmDialogProps): ReactNode {
  const styles = useStyles();
  const theme = useTheme();
  if (request === null) return null;
  const isDestructive = request.tone === 'destructive';
  const dialog = (
    <View testID={testID} style={styles.scrim} accessibilityViewIsModal>
      <View testID={request.testID} style={styles.card}>
        <AppText testID={`${request.testID}.title`} variant="sectionHeading" isHeader>
          {request.title}
        </AppText>
        <AppText testID={`${request.testID}.body`}>{request.body}</AppText>
        <View style={styles.buttons}>
          <PressableSurface
            label={request.cancelLabel}
            onPress={() => {
              onAnswer('cancelled');
            }}
            testID={`${request.testID}.cancel`}
            radius={RADII.md}
            fill={theme.colors.sunken}
            isReducedMotion={isReducedMotion}
            faceStyle={styles.buttonFace}
            layoutStyle={styles.button}
          >
            <AppText variant="buttonLabel">{request.cancelLabel}</AppText>
          </PressableSurface>
          <PressableSurface
            label={request.confirmLabel}
            onPress={() => {
              onAnswer('confirmed');
            }}
            testID={`${request.testID}.confirm`}
            radius={RADII.md}
            fill={isDestructive ? theme.colors.dangerSurface : theme.colors.primary}
            isReducedMotion={isReducedMotion}
            faceStyle={styles.buttonFace}
            layoutStyle={styles.button}
          >
            <AppText variant="buttonLabel" tone={isDestructive ? 'danger' : 'onPrimary'}>
              {request.confirmLabel}
            </AppText>
          </PressableSurface>
        </View>
      </View>
    </View>
  );
  if (Platform.OS === 'ios')
    return <AboveModalScreens isAccessibilityModal>{dialog}</AboveModalScreens>;
  return (
    <Modal
      visible
      transparent
      animationType={isReducedMotion ? 'none' : 'fade'}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => {
        onAnswer('dismissed');
      }}
    >
      {dialog}
    </Modal>
  );
}
