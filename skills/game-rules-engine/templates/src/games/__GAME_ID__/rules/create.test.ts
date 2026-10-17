// src/games/__GAME_ID__/rules/create.test.ts
import fc from 'fast-check';

import { create, shapeFor } from './create';
import { outcome } from './outcome';

const seedArb = fc.integer({ min: 0, max: 4_294_967_295 });
const difficultyArb = fc.integer({ min: 0, max: 100 });

/** Readable board text for pinned goldens: '#' lit, '.' dark, one line per row. */
function boardText(cells: readonly number[], cols: number): string {
  const rows: string[] = [];
  for (let start = 0; start < cells.length; start += cols) {
    rows.push(
      cells
        .slice(start, start + cols)
        .map((cell) => (cell === 1 ? '#' : '.'))
        .join(''),
    );
  }
  return rows.join('\n');
}

describe('create', () => {
  it('keeps the pinned board for seed 1 at difficulty 0 (a changed board breaks shipped levels)', () => {
    const state = create(1, 0);
    expect(boardText(state.cells, state.cols)).toBe(GOLDEN_SEED_1_BOARD);
    expect(state.maxMoves).toBe(6);
  });

  it('grows the grid and the scramble with difficulty', () => {
    expect(shapeFor(0)).toStrictEqual({ side: 3, presses: 2 });
    expect(shapeFor(50)).toStrictEqual({ side: 4, presses: 7 });
    expect(shapeFor(100)).toStrictEqual({ side: 5, presses: 12 });
  });

  it('clamps difficulties outside 0..100', () => {
    expect(create(5, -3)).toStrictEqual(create(5, 0));
    expect(create(5, 250)).toStrictEqual(create(5, 100));
  });

  describe('properties', () => {
    it('gives the same state for the same seed and difficulty', () => {
      fc.assert(
        fc.property(seedArb, difficultyArb, (seed, difficulty) => {
          expect(create(seed, difficulty)).toStrictEqual(create(seed, difficulty));
        }),
      );
    });

    it('starts every game unfinished', () => {
      fc.assert(
        fc.property(seedArb, difficultyArb, (seed, difficulty) => {
          expect(outcome(create(seed, difficulty)).kind).toBe('playing');
        }),
      );
    });
  });
});

const GOLDEN_SEED_1_BOARD = ['###', '###', '..#'].join('\n');
