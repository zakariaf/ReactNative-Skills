// src/ui/feedback/delayed-placeholder.tsx
import { StyleSheet, View } from 'react-native';

import { useDelayedVisibility } from './use-delayed-visibility';

import type { ReactNode } from 'react';

export type DelayedPlaceholderProps = {
  /** True while the first load runs (the state is 'loading'). */
  readonly isLoading: boolean;
  /** Shaped like the content it stands for (SkeletonBlock rows), so nothing jumps when it lands. */
  readonly placeholder: ReactNode;
  /** Translated, read by screen readers while the placeholder shows: "Loading tasks". */
  readonly label: string;
  /** The placeholder's id, '<screen>.state.loading'. */
  readonly testID: string;
  /** What shows once loading ended and the placeholder's hold is over. */
  readonly children: ReactNode;
};

const styles = StyleSheet.create({ fill: { flexGrow: 1 } });

/**
 * Shows nothing for a fast load, the placeholder for a slow one, and keeps a shown placeholder
 * for its minimum time before the content replaces it (PLACEHOLDER_TIMING).
 */
export function DelayedPlaceholder(props: DelayedPlaceholderProps): ReactNode {
  const isVisible = useDelayedVisibility(props.isLoading);
  if (isVisible) {
    return (
      <View
        testID={props.testID}
        style={styles.fill}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={props.label}
        accessibilityState={{ busy: true }}
      >
        {props.placeholder}
      </View>
    );
  }
  // The first moments of a load stay blank on purpose: a fast answer then never flashes.
  if (props.isLoading) return <View testID={`${props.testID}.pending`} style={styles.fill} />;
  return props.children;
}
