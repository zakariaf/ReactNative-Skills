// src/features/tasks/components/progress-bar.tsx
// Example (a shape to imitate): the one sanctioned layout key. An absolutely positioned, childless
// fill animates its width (scaleX would smear the rounded end); the marker line states why.
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';

import { timingOf } from '@/ui/motion/moment-config';
import { MOTION_MOMENTS } from '@/ui/motion/motion-moments';

import type { ReactNode } from 'react';

const FILL = timingOf(MOTION_MOMENTS.progressFill);

const styles = StyleSheet.create({ fill: { position: 'absolute', top: 0, bottom: 0, start: 0 } });

export function ProgressBar({ share, color }: { readonly share: number; readonly color: string }): ReactNode {
  const width = useDerivedValue(() => withTiming(share, FILL));
  const style = useAnimatedStyle(() => ({
    // motion-layout: an absolute, childless fill; scaleX would smear its rounded end
    width: `${String(width.get() * 100)}%`,
  }));
  return (
    <View>
      <Animated.View style={[styles.fill, { backgroundColor: color }, style]} />
    </View>
  );
}
