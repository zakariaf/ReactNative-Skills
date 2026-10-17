// src/features/tasks/use-title-shake.ts
// The rejected-title shake: a finite repeat inside a sequence that ends at rest, so reduced motion
// (which jumps to the last step) leaves the field where it belongs. The message says why.
import { useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { SPACING } from '@/theme/tokens';
import { timingOf } from '@/ui/motion/moment-config';
import { MOTION_MOMENTS } from '@/ui/motion/motion-moments';

import type { SharedValue } from 'react-native-reanimated';

const SHAKE = MOTION_MOMENTS.titleRejected;
const STEP = timingOf(SHAKE);

export type TitleShake = { readonly offset: SharedValue<number>; readonly shake: () => void };

export function useTitleShake(): TitleShake {
  const offset = useSharedValue(0);
  function shake(): void {
    offset.set(
      withSequence(
        withTiming(-SPACING.xs, STEP),
        withRepeat(withTiming(SPACING.xs, STEP), SHAKE.repeat, true),
        withTiming(0, STEP),
      ),
    );
  }
  return { offset, shake };
}
