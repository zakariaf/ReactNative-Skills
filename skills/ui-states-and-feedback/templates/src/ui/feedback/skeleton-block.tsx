// src/ui/feedback/skeleton-block.tsx
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { RADII } from '@/theme/tokens';

import type { ReactNode } from 'react';
import type { DimensionValue } from 'react-native';

export type SkeletonBlockProps = {
  /** The width of the text or picture it stands for ('70%' for a title line). */
  readonly width: DimensionValue;
  /** The height of that line or picture in pt (a row's minimum height for a whole row). */
  readonly height: number;
  /** Optional: a placeholder's blocks need no id of their own; tests may give one. */
  readonly testID?: string;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    block: { backgroundColor: theme.colors.sunken, borderRadius: RADII.sm },
  });
  return styles;
});

/**
 * One grey block of a placeholder. It does not shimmer: a still block needs no reduced-motion
 * path, and a shimmer is a loop moment motion-and-animation would own. Hidden from screen
 * readers; the DelayedPlaceholder around it carries the label.
 */
export function SkeletonBlock({ width, height, testID }: SkeletonBlockProps): ReactNode {
  const styles = useStyles();
  return (
    <View
      testID={testID}
      style={[styles.block, { width, height }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
