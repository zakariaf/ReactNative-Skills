// src/features/tasks/use-task-pulse.ts
import { useEffect } from 'react';
import { useFrameCallback, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useReduceMotion } from '@/ui/a11y/use-reduce-motion';

export function useTaskPulse(onDone: () => void) {
  const isReduceMotion = useReduceMotion();
  const scale = useSharedValue(1);
  const startedAt = useSharedValue(-1);
  useEffect(() => {
    scale.set(isReduceMotion ? 1 : withRepeat(withTiming(1.05), -1, true));
  }, [isReduceMotion, scale]);
  useFrameCallback((frame) => {
    if (startedAt.get() < 0) startedAt.set(frame.timestamp);
    if (frame.timestamp - startedAt.get() > 1000) scheduleOnRN(onDone);
  });
  return scale;
}
