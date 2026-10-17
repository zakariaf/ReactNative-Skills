// src/ui/slider.tsx
import { Pressable, StyleSheet } from 'react-native';

import type { AccessibilityActionEvent } from 'react-native';
import type { ReactNode } from 'react';

export type SliderProps = {
  readonly label: string;
  readonly value: number;
  readonly onAction: (event: AccessibilityActionEvent) => void;
};

const styles = StyleSheet.create({ track: { minHeight: 44 } });

export function Slider(props: SliderProps): ReactNode {
  return (
    <Pressable
      accessibilityRole="adjustable"
      accessibilityLabel={props.label}
      accessibilityValue={{ min: 0, max: 100, now: props.value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={props.onAction}
      style={styles.track}
    />
  );
}
