// src/core/game/testing/render-cells.test.ts
import { renderCells } from './render-cells';

describe('renderCells', () => {
  it('draws one text row per board row, filled cells as # and empty cells as .', () => {
    expect(renderCells([0, 1, 1, 0, 0, 1], 3)).toBe('.##\n..#');
  });

  it('returns an empty string for an empty board', () => {
    expect(renderCells([], 4)).toBe('');
  });
});
