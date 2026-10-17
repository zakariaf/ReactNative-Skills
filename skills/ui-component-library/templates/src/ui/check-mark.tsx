// src/ui/check-mark.tsx
import { StyleSheet, View } from 'react-native';

import { COMPONENT_SPECS } from './component-specs';

import type { ReactNode } from 'react';

const MARK = COMPONENT_SPECS.checkMark;

export type CheckMarkProps = {
  readonly color: string;
  readonly testID?: string;
};

const styles = StyleSheet.create({
  // A check mark never mirrors: its frame lays out left to right in every language.
  frame: {
    direction: 'ltr',
    width: MARK.height,
    height: MARK.height,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The short and long strokes are the bottom and end edges of a narrow box turned 45 degrees.
  mark: {
    width: MARK.width,
    height: MARK.height,
    borderBottomWidth: MARK.stroke,
    borderEndWidth: MARK.stroke,
    transform: [{ rotate: '45deg' }],
  },
});

/** A drawn check: the shape that says "on" or "chosen" without colour. Decorative. */
export function CheckMark({ color, testID }: CheckMarkProps): ReactNode {
  return (
    <View
      style={styles.frame}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      {...(testID === undefined ? {} : { testID })}
    >
      <View style={[styles.mark, { borderColor: color }]} />
    </View>
  );
}
