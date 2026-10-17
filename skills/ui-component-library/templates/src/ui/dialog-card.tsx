// src/ui/dialog-card.tsx
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { shadow } from '@/theme/shadow-styles';

import { AppText } from './app-text';
import { COMPONENT_SPECS } from './component-specs';

import type { ReactNode } from 'react';

const DIALOG = COMPONENT_SPECS.dialog;

export type DialogCardProps = {
  /** The card's id (`delete-task-dialog.card`): parts `.title` and `.body` are derived from it. */
  readonly testID: string;
  /** Translated. */
  readonly title: string;
  readonly body?: string;
  /** A large IconTile above the title. */
  readonly art?: ReactNode;
  /** The buttons: a DialogButtonRow, or stacked block buttons. */
  readonly children: ReactNode;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    // The one static shadow among flat surfaces: a dialog floats above the scrim.
    card: {
      alignSelf: 'stretch',
      gap: DIALOG.gap,
      paddingTop: DIALOG.paddingTop,
      paddingInline: DIALOG.paddingInline,
      paddingBottom: DIALOG.paddingBottom,
      borderRadius: DIALOG.radius,
      backgroundColor: theme.colors.surface,
      ...shadow(DIALOG.elevation, theme.colors.shadow, DIALOG.elevation * 2),
    },
  });
  return styles;
});

/**
 * A dialog: optional art, a title (a header), a body, then the buttons with the safe choice first.
 * Drawn on a Scrim, the modal root; the card itself is never marked modal.
 */
export function DialogCard({ testID, title, body, art, children }: DialogCardProps): ReactNode {
  const styles = useStyles();
  return (
    <View style={styles.card} testID={testID}>
      {art}
      <AppText variant="heading" isHeader testID={`${testID}.title`}>
        {title}
      </AppText>
      {body === undefined ? null : <AppText testID={`${testID}.body`}>{body}</AppText>}
      {children}
    </View>
  );
}
