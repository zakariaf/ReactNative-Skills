// src/ui/motion/use-celebration.ts
// The only way the app plays a celebration moment: bounded by its plan, played once per event,
// skippable at any time, and never in the way. It has no "is playing" flag on purpose: nothing may
// wait for a celebration or lock input while one runs. Call play() from the handler that committed
// the result, after the commit (never from a mount effect, which replays it on every remount).
import { useRef } from 'react';
import { cancelAnimation, Easing, useSharedValue, withTiming } from 'react-native-reanimated';

import { useReduceMotion } from '@/ui/a11y/use-reduce-motion';

import { celebrationPlanOf } from './moment-config';

import type { CelebrationPlan } from './moment-config';
import type { MotionMoment } from './motion-moments';
import type { SharedValue } from 'react-native-reanimated';

export type Celebration = {
  /** Milliseconds into the celebration, 0 to plan.totalMs. At rest it sits at the end. */
  readonly elapsedMs: SharedValue<number>;
  readonly plan: CelebrationPlan;
  /** Motion is reduced: play() jumps to the end state, and a burst draws nothing. */
  readonly isReduced: boolean;
  /** Plays once per event key (a double tap or a re-render replays nothing). */
  readonly play: (eventKey: string) => void;
  /** Jumps to the end state at once: a tap anywhere, or the next action. */
  readonly skip: () => void;
};

export function useCelebration(moment: MotionMoment): Celebration {
  const plan = celebrationPlanOf(moment);
  const isReduced = useReduceMotion();
  const elapsedMs = useSharedValue(plan.totalMs);
  const lastEventKey = useRef<string | null>(null);

  function play(eventKey: string): void {
    if (lastEventKey.current === eventKey) return;
    lastEventKey.current = eventKey;
    cancelAnimation(elapsedMs);
    if (isReduced) {
      elapsedMs.set(plan.totalMs);
      return;
    }
    elapsedMs.set(0);
    elapsedMs.set(withTiming(plan.totalMs, { duration: plan.totalMs, easing: Easing.linear }));
  }

  function skip(): void {
    cancelAnimation(elapsedMs);
    elapsedMs.set(plan.totalMs);
  }

  return { elapsedMs, plan, isReduced, play, skip };
}
