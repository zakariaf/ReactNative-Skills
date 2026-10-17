// src/features/tasks/components/due-chip.tsx
// The due-date chip tints when a task becomes overdue: a Reanimated CSS transition, which no
// reduce-motion setting reaches, so it is switched off here when motion is reduced.
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
