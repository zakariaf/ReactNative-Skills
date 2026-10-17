// src/ui/confetti.tsx
import { Canvas } from '@shopify/react-native-skia';
import { StyleSheet } from 'react-native';

import type { ReactNode } from 'react';

const styles = StyleSheet.create({ fill: { position: 'absolute', inset: 0 } });

// Decoration only: marked so, and the screen reader skips it on purpose.
export function Confetti(): ReactNode {
  return <Canvas style={styles.fill} accessible={false} pointerEvents="none" />;
}
