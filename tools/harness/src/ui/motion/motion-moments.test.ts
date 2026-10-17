// src/ui/motion/motion-moments.test.ts
// The Jest twin of check-motion's catalog rules: a broken catalog fails here before the checker runs.
import { celebrationPlanOf } from './moment-config';
import { CELEBRATION_LIMITS, MOTION_MOMENTS, REDUCED_BY_KIND } from './motion-moments';

import type { MomentId, MotionMoment } from './motion-moments';

/** Object.entries widens the keys to string; the catalog's keys are exactly the moment ids. */
const MOMENTS = Object.entries(MOTION_MOMENTS) as readonly (readonly [MomentId, MotionMoment])[];

describe('MOTION_MOMENTS', () => {
  it.each(MOMENTS)('gives %s a reduced alternative its kind allows', (_id, moment) => {
    const allowed: readonly string[] = REDUCED_BY_KIND[moment.kind];
    expect(allowed).toContain(moment.reduced);
  });

  it.each(MOMENTS)('names what starts %s', (_id, moment) => {
    expect(moment.trigger.trim()).not.toBe('');
  });

  it('keeps every celebration inside its budget', () => {
    const celebrations = MOMENTS.filter(([, moment]) => moment.kind === 'celebration');
    const over = celebrations.filter(([, moment]) => {
      const plan = celebrationPlanOf(moment);
      return plan.totalMs > CELEBRATION_LIMITS.maxMs || plan.pieces > CELEBRATION_LIMITS.maxPieces;
    });
    expect(over).toStrictEqual([]);
  });

  it('repeats only feedback moments, and finitely', () => {
    const repeating = MOMENTS.filter(([, moment]) => moment.repeat !== undefined);
    const wrong = repeating.filter(
      ([, moment]) =>
        moment.kind !== 'feedback' || !Number.isInteger(moment.repeat) || (moment.repeat ?? 0) < 1,
    );
    expect(wrong).toStrictEqual([]);
  });
});
