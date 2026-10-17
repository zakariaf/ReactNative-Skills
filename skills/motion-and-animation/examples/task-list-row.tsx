// src/features/tasks/components/task-list-row.tsx
// Example (a shape to imitate): enter and exit as layout animations. The list removes a task from
// state at once and the exiting animation plays on its own; under reduced motion both become the
// reduced fade (reducedEntering/reducedExiting keep it a real fade). Wrap the list in
// <LayoutAnimationConfig skipEntering> so rows do not animate in on the first render.
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
