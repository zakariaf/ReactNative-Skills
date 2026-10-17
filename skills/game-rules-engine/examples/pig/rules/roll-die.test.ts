// src/games/pig/rules/roll-die.test.ts
import fc from 'fast-check';

import { seedRng } from '@/core/rng/sfc32';

import { rollDie } from './roll-die';

import type { RngState } from '@/core/rng/sfc32';

function facesOf(start: RngState, count: number): number[] {
  const faces: number[] = [];
  let rng = start;
  for (let i = 0; i < count; i += 1) {
    const roll = rollDie(rng);
    faces.push(roll.face);
    rng = roll.rng;
  }
  return faces;
}

describe('rollDie', () => {
  it('keeps the pinned rolls for seed 1 (a changed stream breaks every saved run)', () => {
    expect(facesOf(seedRng(1), 10)).toStrictEqual(GOLDEN_SEED_1_ROLLS);
  });

  it('shows a face from 1 to 6 and advances the stream', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_294_967_295 }), (seed) => {
        const start = seedRng(seed);
        const roll = rollDie(start);
        expect(roll.face).toBeGreaterThanOrEqual(1);
        expect(roll.face).toBeLessThanOrEqual(6);
        expect(roll.rng).not.toStrictEqual(start);
      }),
    );
  });
});

const GOLDEN_SEED_1_ROLLS = [6, 4, 3, 1, 4, 3, 3, 3, 2, 3];
