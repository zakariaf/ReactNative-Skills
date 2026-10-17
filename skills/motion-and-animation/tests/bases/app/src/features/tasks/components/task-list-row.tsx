// src/features/tasks/components/task-list-row.tsx
// A task row that fades in when added and out when deleted: layout animations, so the list removes
// the task from state at once and the exit plays on its own.
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

import { reducedEntering, reducedExiting, timingOf } from '@/ui/motion/moment-config';
import { MOTION_MOMENTS } from '@/ui/motion/motion-moments';

import type { ReactNode } from 'react';

const ENTER = timingOf(MOTION_MOMENTS.taskRowEnter);
const EXIT = timingOf(MOTION_MOMENTS.taskRowExit);
// A layout builder keeps its own curve unless it is given one: pass the moment's easing with its
// duration, so the row moves on the curve the catalog names.
const FADE_IN = FadeInDown.duration(ENTER.duration ?? 0);
const FADE_OUT = FadeOutUp.duration(EXIT.duration ?? 0);
const MOMENT_ENTERING = ENTER.easing === undefined ? FADE_IN : FADE_IN.easing(ENTER.easing);
const MOMENT_EXITING = EXIT.easing === undefined ? FADE_OUT : FADE_OUT.easing(EXIT.easing);

export type TaskListRowProps = { readonly isReducedMotion: boolean; readonly children: ReactNode };

export function TaskListRow({ isReducedMotion, children }: TaskListRowProps): ReactNode {
  const entering = isReducedMotion ? reducedEntering() : MOMENT_ENTERING;
  const exiting = isReducedMotion ? reducedExiting() : MOMENT_EXITING;
  return (
    <Animated.View entering={entering} exiting={exiting}>
      {children}
    </Animated.View>
  );
}
