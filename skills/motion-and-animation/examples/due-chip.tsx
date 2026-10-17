// src/features/tasks/components/due-chip.tsx
// Example (a shape to imitate): a Reanimated CSS transition. Reanimated 4.5.1 applies no
// reduce-motion setting to CSS animations and transitions, so the condition sits on the key itself.
import Animated from 'react-native-reanimated';

import { timingOf } from '@/ui/motion/moment-config';
import { MOTION_MOMENTS } from '@/ui/motion/motion-moments';

import type { ReactNode } from 'react';

const TINT = timingOf(MOTION_MOMENTS.dueChipTint);

export type DueChipProps = { readonly color: string; readonly isReducedMotion: boolean; readonly children: ReactNode };

export function DueChip({ color, isReducedMotion, children }: DueChipProps): ReactNode {
  return (
    <Animated.View
      style={{
        backgroundColor: color,
        transitionProperty: isReducedMotion ? 'none' : 'backgroundColor',
        transitionDuration: TINT.duration ?? 0,
      }}
    >
      {children}
    </Animated.View>
  );
}
