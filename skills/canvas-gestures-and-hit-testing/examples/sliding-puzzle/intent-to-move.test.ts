// src/games/sliding-puzzle/canvas/intent-to-move.test.ts
import { intentToMove } from './intent-to-move';

import type { SlidingPuzzleState } from '@/games/sliding-puzzle/rules/sliding-puzzle-rules';

/** 3 × 3, the gap in the top-left corner. */
const CORNER: SlidingPuzzleState = { size: 3, tiles: [0, 1, 2, 3, 4, 5, 6, 7, 8] };
const SOLVED: SlidingPuzzleState = { size: 3, tiles: [1, 2, 3, 4, 5, 6, 7, 8, 0] };
const board = (col: number, row: number) => ({ regionId: 'board', col, row });

describe('sliding puzzle intentToMove', () => {
  it('slides the tile beside the gap in the swiped direction', () => {
    expect(intentToMove(CORNER, { kind: 'swipe', direction: 'left', from: null })).toStrictEqual({
      kind: 'slide-tile',
      from: 1,
    });
    expect(intentToMove(CORNER, { kind: 'swipe', direction: 'up', from: null })).toStrictEqual({
      kind: 'slide-tile',
      from: 3,
    });
  });

  it('refuses a swipe that would move nothing, so it costs no move', () => {
    expect(intentToMove(CORNER, { kind: 'swipe', direction: 'right', from: null })).toBeNull();
    expect(intentToMove(CORNER, { kind: 'swipe', direction: 'down', from: null })).toBeNull();
  });

  it('slides a tapped tile only when it is beside the gap', () => {
    const tap = (col: number, row: number) => ({
      kind: 'tap' as const,
      target: board(col, row),
      selected: null,
    });
    expect(intentToMove(CORNER, tap(1, 0))).toStrictEqual({ kind: 'slide-tile', from: 1 });
    expect(intentToMove(CORNER, tap(2, 2))).toBeNull();
  });

  it('gives no move once the puzzle is solved', () => {
    expect(intentToMove(SOLVED, { kind: 'swipe', direction: 'right', from: null })).toBeNull();
  });

  it('ignores long presses, drags and aims', () => {
    expect(intentToMove(CORNER, { kind: 'long-press', target: board(1, 0) })).toBeNull();
    expect(intentToMove(CORNER, { kind: 'drag-end', from: board(1, 0), to: null })).toBeNull();
    expect(intentToMove(CORNER, { kind: 'aim', dx: 4, dy: 9 })).toBeNull();
  });
});
