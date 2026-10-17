// src/ui/sub-row.tsx
import { StyleSheet, View } from 'react-native';

import { AppText } from './app-text';
import { COMPONENT_SPECS } from './component-specs';

import type { ReactNode } from 'react';

const ROW = COMPONENT_SPECS.row;

export type SubRowProps = {
  /** Translated. */
  readonly label: string;
  readonly testID: string;
  /** The control it holds (a Slider, a SegmentedControl) with its own id. */
  readonly children: ReactNode;
};

const styles = StyleSheet.create({
  // Indented to line up with the row label above it; no separator, it belongs to that row.
  row: {
    paddingStart: ROW.subRowIndent,
    paddingEnd: ROW.paddingInline,
    paddingBottom: ROW.paddingBlock,
    gap: ROW.labelGap,
  },
});

/** A secondary line under a row: a muted label and the control that refines the row above. */
export function SubRow({ label, testID, children }: SubRowProps): ReactNode {
  return (
    <View style={styles.row} testID={testID}>
      <AppText variant="rowDescription" tone="muted" testID={`${testID}.label`}>
        {label}
      </AppText>
      {children}
    </View>
  );
}
