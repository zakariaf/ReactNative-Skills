// src/games/__GAME_ID__/rules/__GAME_ID__-tuning.test.ts
import { ENDLESS_DIFFICULTY } from '@/core/game/difficulty';

import { TUNING, knobsFor, pressesFor } from './__GAME_ID__-tuning';

describe('knobsFor', () => {
  it('maps the level scale 0..99 onto the rows in equal bands, easiest first', () => {
    const sides = [0, 33, 34, 66, 67, 99].map((difficulty) => knobsFor(difficulty).side);
    expect(sides).toStrictEqual([3, 3, 4, 4, 5, 5]);
  });

  it('clamps difficulties outside the scale to the first and the last row', () => {
    expect(knobsFor(-5)).toStrictEqual(TUNING.levelRows[0]);
    expect(knobsFor(ENDLESS_DIFFICULTY)).toStrictEqual(TUNING.levelRows.at(-1));
  });

  it('makes every row at least as hard as the one before', () => {
    TUNING.levelRows.forEach((row, index) => {
      const previous = TUNING.levelRows[index - 1] ?? row;
      expect(row.side).toBeGreaterThanOrEqual(previous.side);
    });
  });
});

describe('pressesFor', () => {
  it('adds one scramble press every difficultyPerPress points', () => {
    const presses = [0, 9, 10, 40, 60, 99, 100].map((difficulty) => pressesFor(difficulty));
    expect(presses).toStrictEqual([2, 2, 3, 6, 8, 11, 12]);
  });

  it('clamps and floors the difficulty first', () => {
    expect(pressesFor(-3)).toBe(TUNING.minPresses);
    expect(pressesFor(19.9)).toBe(pressesFor(10));
  });
});
