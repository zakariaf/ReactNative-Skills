// src/ui/radio-mark.tsx
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';

import { COMPONENT_SPECS } from './component-specs';

import type { ReactNode } from 'react';

const RADIO = COMPONENT_SPECS.radio;

export type RadioMarkProps = {
  readonly isSelected: boolean;
  /** A part id, usually `<row or card>.radio`; the dot inside is `<row or card>.radio.dot`. */
  readonly testID?: string;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    ring: {
      width: RADIO.size,
      height: RADIO.size,
      borderRadius: RADIO.size / 2,
      borderWidth: RADIO.border,
      borderColor: theme.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ringSelected: { borderColor: theme.colors.primary },
    dot: {
      width: RADIO.dot,
      height: RADIO.dot,
      borderRadius: RADIO.dot / 2,
      backgroundColor: theme.colors.primary,
    },
  });
  return styles;
});

/** A radio ring: empty, or with a dot when chosen. The row or card around it is the radio. */
export function RadioMark({ isSelected, testID }: RadioMarkProps): ReactNode {
  const styles = useStyles();
  const dotId = testID === undefined ? {} : { testID: `${testID}.dot` };
  return (
    <View
      style={[styles.ring, isSelected && styles.ringSelected]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      {...(testID === undefined ? {} : { testID })}
    >
      {isSelected ? <View style={styles.dot} {...dotId} /> : null}
    </View>
  );
}
