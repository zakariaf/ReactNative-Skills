// src/core/game/difficulty.test.ts
import fc from 'fast-check';

import {
  ENDLESS_DIFFICULTY,
  MAX_LEVEL_DIFFICULTY,
  clampDifficulty,
  isEndlessDifficulty,
  rowFor,
} from './difficulty';

describe('clampDifficulty', () => {
  it('keeps whole difficulties 0..100 and clamps everything else into the range', () => {
    expect([-5, 0, 45.9, 99, 100, 250].map(clampDifficulty)).toStrictEqual([
      0, 0, 45, 99, 100, 100,
    ]);
  });
});

describe('isEndlessDifficulty', () => {
  it('reserves 100 (and anything clamped to it) for the endless run', () => {
    expect([0, 99, ENDLESS_DIFFICULTY, 140].map(isEndlessDifficulty)).toStrictEqual([
      false,
      false,
      true,
      true,
    ]);
  });
});

describe('rowFor', () => {
  it('splits the level scale into equal bands, easiest first', () => {
    expect([0, 24, 25, 49, 50, 74, 75, 99].map((level) => rowFor(level, 4))).toStrictEqual([
      0, 0, 1, 1, 2, 2, 3, 3,
    ]);
  });

  it('puts a medium daily difficulty of 45 in the second of four rows', () => {
    expect(rowFor(45, 4)).toBe(1);
  });

  it('clamps difficulties outside 0..99 to the first and last row', () => {
    expect([-3, MAX_LEVEL_DIFFICULTY, ENDLESS_DIFFICULTY].map((d) => rowFor(d, 4))).toStrictEqual([
      0, 3, 3,
    ]);
  });

  it('names an existing row for every difficulty and never falls as it rises', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -50, max: 150 }),
        fc.integer({ min: 1, max: 12 }),
        (difficulty, rowCount) => {
          const row = rowFor(difficulty, rowCount);
          expect(row).toBeGreaterThanOrEqual(0);
          expect(row).toBeLessThan(rowCount);
          expect(rowFor(difficulty + 1, rowCount)).toBeGreaterThanOrEqual(row);
        },
      ),
    );
  });
});
