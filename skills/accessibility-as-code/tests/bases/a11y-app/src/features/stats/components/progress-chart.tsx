// src/features/stats/components/progress-chart.tsx
import { Canvas } from '@shopify/react-native-skia';
import { StyleSheet } from 'react-native';

import type { ReactNode } from 'react';

const styles = StyleSheet.create({ chart: { height: 160 } });

// One accessible image: the label is t() of a pure describeProgress(week) ("6 of 9 tasks done this week").
export function ProgressChart({ label }: { readonly label: string }): ReactNode {
  return <Canvas style={styles.chart} accessible accessibilityRole="image" accessibilityLabel={label} />;
}
