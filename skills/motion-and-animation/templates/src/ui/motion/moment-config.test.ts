// src/ui/motion/moment-config.test.ts
import { Easing, ReduceMotion } from 'react-native-reanimated';

import { MOTION_MS, SPRINGS } from '@/theme/motion';

import {
  celebrationPlanOf,
  delayOf,
  easingOf,
  REDUCED_FADE,
  reducedEntering,
  reducedExiting,
  springOf,
  staggerOf,
  timingOf,
} from './moment-config';

import type { MotionMoment } from './motion-moments';

const CHECK = {
  kind: 'state',
  trigger: 'A task is marked done',
  timing: { duration: 'fast', easing: 'standard' },
  reduced: 'instant',
} as const satisfies MotionMoment;

const SETTLE = {
  kind: 'transition',
  trigger: 'A sheet settles after a drag',
  timing: { spring: 'sheet', delay: 'pressIn' },
  reduced: 'fade',
} as const satisfies MotionMoment;

const BURST = {
  kind: 'celebration',
  trigger: 'The last open task of a list is done',
  timing: { duration: 'slow', easing: 'decelerate', delay: 'fast', stagger: 'pressIn' },
  reduced: 'none',
  pieces: 12,
} as const satisfies MotionMoment;

describe('timingOf', () => {
  it('takes the duration from the token the moment names', () => {
    expect(timingOf(CHECK).duration).toBe(MOTION_MS.fast);
  });

  it('refuses a spring moment', () => {
    expect(() => timingOf(SETTLE)).toThrow('is not a timing moment');
  });
});

describe('springOf', () => {
  it('returns the complete spring token', () => {
    expect(springOf(SETTLE)).toStrictEqual(SPRINGS.sheet);
    expect(springOf(SETTLE)).toHaveProperty('mass');
  });

  it('refuses a timing moment', () => {
    expect(() => springOf(CHECK)).toThrow('is not a spring moment');
  });
});

describe('easingOf', () => {
  it('maps linear to the linear curve', () => {
    expect(easingOf('linear')).toBe(Easing.linear);
  });
});

describe('delayOf and staggerOf', () => {
  it('reads the delay token, and 0 without one', () => {
    expect(delayOf(SETTLE)).toBe(MOTION_MS.pressIn);
    expect(delayOf(CHECK)).toBe(0);
  });

  it('staggers each item one token after the one before', () => {
    expect(staggerOf(BURST, 0)).toBe(0);
    expect(staggerOf(BURST, 3)).toBe(3 * MOTION_MS.pressIn);
    expect(staggerOf(CHECK, 3)).toBe(0);
  });
});

describe('celebrationPlanOf', () => {
  it('ends when the last piece settles', () => {
    const plan = celebrationPlanOf(BURST);
    expect(plan.totalMs).toBe(MOTION_MS.fast + MOTION_MS.slow + 11 * MOTION_MS.pressIn);
    expect(plan.pieces).toBe(12);
  });
});

describe('REDUCED_FADE', () => {
  it('opts out of the root config so the fade really fades', () => {
    expect(REDUCED_FADE.reduceMotion).toBe(ReduceMotion.Never);
    expect(REDUCED_FADE.duration).toBe(MOTION_MS.reducedFade);
  });
});

describe('reducedEntering and reducedExiting', () => {
  it('fades in and out for the reduced fade time, outside the root config', () => {
    for (const builder of [reducedEntering(), reducedExiting()]) {
      expect(builder.getDuration()).toBe(MOTION_MS.reducedFade);
      expect(builder.getReduceMotion()).toBe(ReduceMotion.Never);
    }
  });
});
