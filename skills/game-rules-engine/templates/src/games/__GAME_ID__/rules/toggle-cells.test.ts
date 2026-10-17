// src/games/__GAME_ID__/rules/toggle-cells.test.ts
import fc from 'fast-check';

import { neighbourhood, toggleCells } from './toggle-cells';

import type { Cell } from './__GAME_ID__-types';

const cellsArb = fc.array(fc.constantFrom<Cell>(0, 1), { minLength: 9, maxLength: 9 });

describe('neighbourhood', () => {
  it('lists the cell and its four neighbours in the middle of the grid', () => {
    expect(neighbourhood(3, 3, 4)).toStrictEqual([1, 3, 4, 5, 7]);
  });

  it('keeps only the neighbours that exist at a corner and on an edge', () => {
    expect(neighbourhood(3, 3, 0)).toStrictEqual([0, 1, 3]);
    expect(neighbourhood(3, 3, 5)).toStrictEqual([2, 4, 5, 8]);
    expect(neighbourhood(4, 2, 7)).toStrictEqual([3, 6, 7]);
  });
});

describe('toggleCells', () => {
  it('toggles exactly the listed cells', () => {
    expect(toggleCells([0, 1, 0, 1], [0, 1])).toStrictEqual([1, 0, 0, 1]);
  });

  it('leaves its input unchanged', () => {
    const cells: readonly Cell[] = [1, 0, 1];
    toggleCells(cells, [0, 1, 2]);
    expect(cells).toStrictEqual([1, 0, 1]);
  });

  it('undoes itself: the same toggle applied twice gives the board back', () => {
    fc.assert(
      fc.property(cellsArb, fc.integer({ min: 0, max: 8 }), (cells, index) => {
        const around = neighbourhood(3, 3, index);
        expect(toggleCells(toggleCells(cells, around), around)).toStrictEqual(cells);
      }),
    );
  });
});
