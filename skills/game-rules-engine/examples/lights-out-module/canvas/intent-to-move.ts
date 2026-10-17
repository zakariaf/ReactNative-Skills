// src/games/lights-out/canvas/intent-to-move.ts
// Shape only: canvas-gestures-and-hit-testing owns this file and its tests. A tap on a board cell
// toggles it; every other intent is ignored. It lives beside the surface, not in rules/, because
// the pure zone of rules/ cannot import the canvas kit's types. Legality is listMoves, so a
// finished board (an empty list) ignores every tap.
import { listMoves } from '@/games/lights-out/rules/list-moves';

import type { CanvasIntent } from '@/canvas/gestures/canvas-intent';
import type { LightsOutMove, LightsOutState } from '@/games/lights-out/rules/lights-out-types';

/** The region id the surface's layout gives the grid. */
export const BOARD_REGION = 'board';

function candidate(state: LightsOutState, intent: CanvasIntent): LightsOutMove | null {
  switch (intent.kind) {
    case 'tap': {
      const { regionId, col, row } = intent.target;
      const isOnBoard = regionId === BOARD_REGION && col >= 0 && row >= 0;
      return isOnBoard && col < state.cols && row < state.rows
        ? { kind: 'toggle', col, row }
        : null;
    }
    case 'long-press':
    case 'swipe':
    case 'drag-end':
    case 'aim':
      return null;
  }
}

/** Pure: an intent becomes a move listMoves lists, or null. */
export function intentToMove(state: LightsOutState, intent: CanvasIntent): LightsOutMove | null {
  const move = candidate(state, intent);
  if (move === null) return null;
  return listMoves(state).some((listed) => listed.col === move.col && listed.row === move.row)
    ? move
    : null;
}
