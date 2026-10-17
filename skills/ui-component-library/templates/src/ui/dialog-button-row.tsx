// src/ui/dialog-button-row.tsx
import { StyleSheet, View } from 'react-native';

import { COMPONENT_SPECS } from './component-specs';

import type { ReactNode } from 'react';

const DIALOG = COMPONENT_SPECS.dialog;

export type DialogButtonRowProps = {
  readonly testID: string;
  /** Buttons with isInRow, the safe choice (Cancel) first; the row mirrors in right-to-left. */
  readonly children: ReactNode;
};

const styles = StyleSheet.create({
  // Wraps: at large text the two buttons stack instead of squeezing their labels.
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: DIALOG.buttonRowGap,
    marginTop: DIALOG.buttonRowMarginTop,
  },
});

/** The button row at the bottom of a dialog. */
export function DialogButtonRow({ testID, children }: DialogButtonRowProps): ReactNode {
  return (
    <View style={styles.row} testID={testID}>
      {children}
    </View>
  );
}
