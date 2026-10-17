// src/core/realtime/fixed-step.test.ts
import fc from 'fast-check';

import { MAX_FRAME_MS, planSteps, STEP_MS, tickToMs } from './fixed-step';

describe('planSteps', () => {
  it('simulates nothing on the first frame after (re)activation', () => {
    expect(planSteps(0, null)).toStrictEqual({ steps: 0, accMs: 0 });
  });

  it('runs one tick per 120 Hz frame and two per 60 Hz frame', () => {
    expect(planSteps(0, STEP_MS).steps).toBe(1);
    expect(planSteps(0, 2 * STEP_MS).steps).toBe(2);
  });

  it('carries the remainder to the next frame', () => {
    const first = planSteps(0, 12);
    expect(first.steps).toBe(1);
    expect(first.accMs).toBeCloseTo(12 - STEP_MS, 9);
    expect(planSteps(first.accMs, 6).steps).toBe(1);
  });

  it('clamps a long gap (background, interruption, GC pause) to 250 ms of catch-up', () => {
    expect(planSteps(0, 5000).steps).toBe(Math.floor(MAX_FRAME_MS / STEP_MS));
  });

  it('ignores a negative frame gap', () => {
    expect(planSteps(3, -20)).toStrictEqual({ steps: 0, accMs: 3 });
  });

  it('keeps the total simulated time exact for gaps inside the clamp', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 40, noNaN: true }), { maxLength: 60 }),
        (gaps) => {
          let acc = 0;
          let steps = 0;
          for (const gap of gaps) {
            const plan = planSteps(acc, gap);
            acc = plan.accMs;
            steps += plan.steps;
          }
          const total = gaps.reduce((sum, gap) => sum + gap, 0);
          expect(steps * STEP_MS + acc).toBeCloseTo(total, 6);
          expect(acc).toBeLessThan(STEP_MS);
        },
      ),
      { seed: 29, numRuns: 200 },
    );
  });
});

describe('tickToMs', () => {
  it('turns ticks into whole timeline milliseconds', () => {
    expect(tickToMs(0)).toBe(0);
    expect(tickToMs(120)).toBe(1000);
    expect(tickToMs(1)).toBe(8);
  });
});
