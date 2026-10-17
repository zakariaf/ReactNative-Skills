// src/ui/progress-bar.tsx
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';

import { COMPONENT_SPECS } from './component-specs';

import type { ReactNode } from 'react';

const PROGRESS = COMPONENT_SPECS.progressBar;
const PERCENT = 100;

export type ProgressBarProps = {
  /** 0..1 */
  readonly value: number;
  /** Translated, with the numbers in it ("3 of 8 tasks done"). */
  readonly label: string;
  readonly testID: string;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    track: {
      height: PROGRESS.height,
      minWidth: PROGRESS.minWidth,
      alignSelf: 'stretch',
      borderRadius: PROGRESS.radius,
      backgroundColor: theme.colors.sunken,
      overflow: 'hidden',
    },
    fill: { height: '100%', backgroundColor: theme.colors.primary },
  });
  return styles;
});

/** A progress track filled from the start edge; not interactive. */
export function ProgressBar({ value, label, testID }: ProgressBarProps): ReactNode {
  const styles = useStyles();
  const share = Math.min(1, Math.max(0, value));
  return (
    <View
      style={styles.track}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: PERCENT, now: Math.round(share * PERCENT) }}
      testID={testID}
    >
      <View
        style={[styles.fill, { width: `${String(share * PERCENT)}%` }]}
        testID={`${testID}.fill`}
      />
    </View>
  );
}
