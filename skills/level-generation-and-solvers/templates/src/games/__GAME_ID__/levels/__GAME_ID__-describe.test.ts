// src/games/__GAME_ID__/levels/__GAME_ID__-describe.test.ts
import { describeLevel } from './__GAME_ID__-describe';

describe('describeLevel', () => {
  it('shows the move limit, then the board row by row', () => {
    const state = { cols: 2, rows: 2, cells: [1, 0, 0, 1], moves: 0, maxMoves: 6 } as const;
    expect(describeLevel(state)).toBe(['moves 6', '#.', '.#'].join('\n'));
  });
});
