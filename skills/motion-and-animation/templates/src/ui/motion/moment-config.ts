// src/ui/motion/moment-config.ts
// Turns a declared moment (motion-moments.ts) into Reanimated configs, so no component assembles a
// duration, a curve or a spring itself and every timing traces back to one catalog entry. The
// reduced fade is the one opt-out from the root reduce-motion config besides functional timers: an
// opacity change that replaces movement must really fade, and ReducedMotionConfig would otherwise
// finish it instantly (every animation that keeps the default ReduceMotion.System does).
import { Easing, FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';

import { EASING, MOTION_MS, SPRINGS } from '@/theme/motion';

import type { EasingToken, MotionMoment, TimedTiming } from './motion-moments';
import type {
  EasingFunction,
  EasingFunctionFactory,
  WithSpringConfig,
  WithTimingConfig,
} from 'react-native-reanimated';

/** The curve a moment names; 'linear' for functional timers and loops that must not ease. */
export function easingOf(token: EasingToken): EasingFunction | EasingFunctionFactory {
  if (token === 'linear') return Easing.linear;
  const [x1, y1, x2, y2] = EASING[token];
  return Easing.bezier(x1, y1, x2, y2);
}

function timedOf(moment: MotionMoment): TimedTiming {
  const { timing } = moment;
  if (!('duration' in timing)) {
    throw new Error(`"${moment.trigger}" is not a timing moment`, { cause: timing });
  }
  return timing;
}

/** withTiming config of a timing moment: its duration token and its curve. */
export function timingOf(moment: MotionMoment): WithTimingConfig {
  const timing = timedOf(moment);
  return { duration: MOTION_MS[timing.duration], easing: easingOf(timing.easing) };
}

/** withSpring config of a spring moment (damping, stiffness and mass come written out). */
export function springOf(moment: MotionMoment): WithSpringConfig {
  const { timing } = moment;
  if (!('spring' in timing)) {
    throw new Error(`"${moment.trigger}" is not a spring moment`, { cause: timing });
  }
  return SPRINGS[timing.spring];
}

/** Start delay in ms (0 without one): the first argument of withDelay. */
export function delayOf(moment: MotionMoment): number {
  const { timing } = moment;
  return 'delay' in timing ? MOTION_MS[timing.delay] : 0;
}

/** Extra delay of the item at `index` of a staggered moment (0 for the first, or without one). */
export function staggerOf(moment: MotionMoment, index: number): number {
  const { timing } = moment;
  return 'stagger' in timing ? index * MOTION_MS[timing.stagger] : 0;
}

/** The timeline of a celebration; totalMs is when its last piece settles. */
export type CelebrationPlan = {
  readonly delayMs: number;
  readonly durationMs: number;
  readonly staggerMs: number;
  readonly pieces: number;
  readonly totalMs: number;
};

/** Delay, then each piece one stagger after the last, each for the duration. */
export function celebrationPlanOf(moment: MotionMoment): CelebrationPlan {
  const timing = timedOf(moment);
  const pieces = moment.pieces ?? 1;
  const delayMs = delayOf(moment);
  const durationMs = MOTION_MS[timing.duration];
  const staggerMs = staggerOf(moment, 1);
  const totalMs = delayMs + durationMs + staggerMs * (pieces - 1);
  return { delayMs, durationMs, staggerMs, pieces, totalMs };
}

/** The reduced alternative "fade": a short opacity change that must not collapse to instant. */
export const REDUCED_FADE: WithTimingConfig = {
  duration: MOTION_MS.reducedFade,
  easing: Easing.linear,
  reduceMotion: ReduceMotion.Never,
};

/** Entering animation of a "fade" moment while motion is reduced (layout animations). */
export function reducedEntering(): FadeIn {
  return FadeIn.duration(MOTION_MS.reducedFade).reduceMotion(ReduceMotion.Never);
}

/** Exiting animation of a "fade" moment while motion is reduced (layout animations). */
export function reducedExiting(): FadeOut {
  return FadeOut.duration(MOTION_MS.reducedFade).reduceMotion(ReduceMotion.Never);
}
