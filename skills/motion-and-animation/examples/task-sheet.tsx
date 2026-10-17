// src/features/tasks/components/task-sheet.tsx
// Example (a shape to imitate): gesture-driven motion. The finger writes the same shared value the
// release spring animates, so a new touch catches the sheet mid-flight; the release spring takes the
// finger's velocity, and closing is committed in onEnd (once), never per frame or in a callback.
// The app root needs GestureHandlerRootView (Expo Router's native Stack adds none).
// onClosed runs while the closing spring is still moving. A parent that unmounts the sheet there
// renders it inside <Animated.View exiting={isReducedMotion ? reducedExiting() : SlideOutDown...}>
// (timed from the moment's tokens) so the close still shows; otherwise it keeps the sheet mounted
// until the next open. Never delay the commit to an animation callback to save the motion.
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
