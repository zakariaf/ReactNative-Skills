// src/features/tasks/components/task-check.tsx
// Example (a shape to imitate): a state moment. The fill follows isDone from wherever it is now
// (useDerivedValue + withTiming retargets, so a second tap mid-animation turns it around); the timing
// comes from the catalog, and the root MotionConfig makes it instant when motion is reduced.
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';

import { timingOf } from '@/ui/motion/moment-config';
import { MOTION_MOMENTS } from '@/ui/motion/motion-moments';

import type { ReactNode } from 'react';

const CHECK = timingOf(MOTION_MOMENTS.taskCheck);

const styles = StyleSheet.create({ fill: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 } });

export type TaskCheckProps = { readonly isDone: boolean; readonly color: string };

export function TaskCheck({ isDone, color }: TaskCheckProps): ReactNode {
  const fill = useDerivedValue(() => withTiming(isDone ? 1 : 0, CHECK));
  const style = useAnimatedStyle(() => ({ opacity: fill.get(), transform: [{ scale: 0.6 + fill.get() * 0.4 }] }));
  return <Animated.View style={[styles.fill, { backgroundColor: color }, style]} />;
}
