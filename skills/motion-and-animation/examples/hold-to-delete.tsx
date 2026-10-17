// src/features/lists/components/hold-to-delete.tsx
// Example (a shape to imitate): a functional moment. The hold is a safety interval, so it opts out
// of reduce motion (ReduceMotion.Never, allowed only in a functional moment's file) and commits the
// delete when, and only when, the hold completes (the one completion callback that may commit).
// Give it a screen-reader alternative (accessibility-as-code: accessibilityActions).
import { Pressable } from 'react-native';
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { timingOf } from '@/ui/motion/moment-config';
import { MOTION_MOMENTS } from '@/ui/motion/motion-moments';

import type { ReactNode } from 'react';

const HOLD = { ...timingOf(MOTION_MOMENTS.holdToDelete), reduceMotion: ReduceMotion.Never };

export type HoldToDeleteProps = { readonly label: string; readonly onConfirm: () => void };

export function HoldToDelete({ label, onConfirm }: HoldToDeleteProps): ReactNode {
  const progress = useSharedValue(0);
  function handlePressIn(): void {
    progress.set(
      withTiming(1, HOLD, (isFinished) => {
        if (isFinished === true) scheduleOnRN(onConfirm);
      }),
    );
  }
  function handlePressOut(): void {
    cancelAnimation(progress);
    progress.set(withTiming(0, timingOf(MOTION_MOMENTS.holdToDelete)));
  }
  const style = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.get() }] }));
  return (
    <Pressable accessibilityLabel={label} onPressIn={handlePressIn} onPressOut={handlePressOut}>
      <Animated.View style={style} />
    </Pressable>
  );
}
