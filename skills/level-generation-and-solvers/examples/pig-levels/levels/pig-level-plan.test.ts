// src/games/pig/levels/pig-level-plan.test.ts
import fc from 'fast-check';

import { create } from '@/games/pig/rules/create';

import {
  difficultyFor,
  LEVELS_PER_PACK,
  MIN_WITNESS_MOVES,
  PIG_LEVEL_PLAN,
  scoreThresholds,
} from './pig-level-plan';

const LEVELS = Array.from({ length: 2 * LEVELS_PER_PACK }, (_, index) => index + 1);

describe('difficultyFor', () => {
  it('rises from 0 at level 1 to 99 at the last level without ever falling', () => {
    const curve = LEVELS.map(difficultyFor);
    expect(curve[0]).toBe(0);
    expect(curve.at(-1)).toBe(99);
    expect(curve).toStrictEqual([...curve].sort((a, b) => a - b));
  });
});

describe('scoreThresholds', () => {
  it('starts at the target, gives two stars at the witness score and three 20 % above it', () => {
    expect(scoreThresholds(50, 70)).toStrictEqual([50, 70, 84]);
  });

  it('keeps two stars above a win and three above two when the witness barely wins', () => {
    expect(scoreThresholds(50, 50)).toStrictEqual([50, 51, 61]);
    expect(scoreThresholds(4, 4)).toStrictEqual([4, 5, 6]);
  });

  it('always returns three strictly ascending whole numbers, the first the target', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), fc.nat(800), (target, witness) => {
        const [win, two, three] = scoreThresholds(target, witness);
        expect(win).toBe(target);
        expect(two).toBeGreaterThanOrEqual(win + 1);
        expect(three).toBeGreaterThan(two);
        expect([win, two, three].every(Number.isInteger)).toBe(true);
      }),
      { seed: 11, numRuns: 200 },
    );
  });
});

describe('PIG_LEVEL_PLAN.rate', () => {
  const start = create(3, 20);
  const won = { ...start, banked: start.target, turn: start.maxTurns };
  const candidate = { level: 5, seed: 3, difficulty: 20, start, line: [], final: won };

  it('rates a witness win from its final score', () => {
    expect(PIG_LEVEL_PLAN.rate({ ...candidate, par: MIN_WITNESS_MOVES })).toStrictEqual({
      kind: 'score',
      thresholds: scoreThresholds(start.target, start.target),
    });
  });

  it('rejects a witness win shorter than MIN_WITNESS_MOVES', () => {
    expect(PIG_LEVEL_PLAN.rate({ ...candidate, par: MIN_WITNESS_MOVES - 1 })).toBeNull();
  });

  it('rejects a final state that is not a win', () => {
    expect(PIG_LEVEL_PLAN.rate({ ...candidate, final: start, par: 20 })).toBeNull();
  });

  it('declares two packs of twenty levels', () => {
    expect(PIG_LEVEL_PLAN.packs).toHaveLength(2);
    expect(PIG_LEVEL_PLAN.levelsPerPack).toBe(20);
  });
});
