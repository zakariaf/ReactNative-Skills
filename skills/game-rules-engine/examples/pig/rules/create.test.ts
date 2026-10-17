// src/games/pig/rules/create.test.ts
import { ENDLESS_DIFFICULTY } from '@/core/game/difficulty';
import { seedRng } from '@/core/rng/sfc32';

import { create } from './create';
import { TUNING } from './pig-tuning';

describe('create', () => {
  it('stores the warmed-up stream of the seed and draws nothing yet', () => {
    expect(create(1, 0).rng).toStrictEqual(seedRng(1));
  });
  it('raises the target and the turns with the difficulty row', () => {
    const shape = (difficulty: number) => {
      const { target, maxTurns } = create(1, difficulty);
      return { target, maxTurns };
    };
    // One difficulty inside each row, easiest first: the rows come from TUNING, never literals.
    expect([0, 30, 60, 99].map(shape)).toStrictEqual(TUNING.levelRows);
  });

  it('starts the endless run with no target', () => {
    expect(create(1, ENDLESS_DIFFICULTY)).toMatchObject({
      target: 0,
      maxTurns: TUNING.endlessRow.maxTurns,
      difficulty: 100,
    });
  });

  it('clamps difficulties outside 0..100', () => {
    expect(create(5, -3)).toStrictEqual(create(5, 0));
    expect(create(5, 250)).toStrictEqual(create(5, ENDLESS_DIFFICULTY));
  });
});
