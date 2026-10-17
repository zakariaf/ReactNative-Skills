// src/features/tasks/components/task-sheet.tsx
// A task sheet the finger drags down; on release it springs open or closed with the finger's speed,
// and a new touch catches it mid-flight (the gesture writes the same shared value).
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { springOf } from '@/ui/motion/moment-config';
import { MOTION_MOMENTS } from '@/ui/motion/motion-moments';

import type { ReactNode } from 'react';

const SETTLE = springOf(MOTION_MOMENTS.sheetSettle);

export type TaskSheetProps = {
  readonly height: number;
  readonly onClosed: () => void;
  readonly children: ReactNode;
};

export function TaskSheet({ height, onClosed, children }: TaskSheetProps): ReactNode {
  const offset = useSharedValue(0);
  const pan = Gesture.Pan()
    .onUpdate((event) => {
      offset.set(Math.max(0, event.translationY));
    })
    .onEnd((event) => {
      const shouldClose = event.translationY > height / 3 || event.velocityY > height;
      offset.set(withSpring(shouldClose ? height : 0, { ...SETTLE, velocity: event.velocityY }));
      if (shouldClose) scheduleOnRN(onClosed);
    });
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: offset.get() }] }));
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={style}>{children}</Animated.View>
    </GestureDetector>
  );
}
