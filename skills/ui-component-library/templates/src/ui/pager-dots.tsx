// src/ui/pager-dots.tsx
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';

import { COMPONENT_SPECS } from './component-specs';

import type { ReactNode } from 'react';

const DOTS = COMPONENT_SPECS.pagerDots;

export type PagerDotsProps = {
  /** Stable page keys; each dot is `<testID>.<key>`. */
  readonly pages: readonly string[];
  readonly current: string;
  readonly testID: string;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignSelf: 'center', gap: DOTS.gap },
    dot: {
      width: DOTS.dot,
      height: DOTS.dot,
      borderRadius: DOTS.dot / 2,
      backgroundColor: theme.colors.border,
    },
    // The current page is wider as well as filled: shape, not colour alone.
    current: { width: DOTS.activeWidth, backgroundColor: theme.colors.primary },
  });
  return styles;
});

/**
 * Where the reader is in a short sequence of pages. Decorative: the screen also writes the step in
 * words ("Step 2 of 4"), which is what screen readers hear.
 */
export function PagerDots({ pages, current, testID }: PagerDotsProps): ReactNode {
  const styles = useStyles();
  return (
    <View
      style={styles.row}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {pages.map((page) => (
        <View
          key={page}
          style={[styles.dot, page === current && styles.current]}
          testID={`${testID}.${page}`}
        />
      ))}
    </View>
  );
}
