// src/games/sliding-puzzle/canvas/intent-to-move.ts
// Swipe to slide the tile beside the gap into it (swipe left: the tile to the gap's right moves
// left), or tap that tile. Directions are physical: swipes never mirror. It lives in the surface
// folder, beside to-view.ts, because game rules may import only src/core and their own folders;
// it is just as pure. Legality is listMoves, so a swipe that moves nothing costs no move.
import { listMoves } from '@/games/sliding-puzzle/rules/sliding-puzzle-rules';

import type { CanvasTarget } from '@/canvas/canvas-layout';
import type { CanvasIntent } from '@/canvas/gestures/canvas-intent';
import type { SwipeDirection } from '@/canvas/gestures/classify-swipe';
import type {
  SlidingPuzzleMove,
  SlidingPuzzleState,
} from '@/games/sliding-puzzle/rules/sliding-puzzle-rules';

/** Where the tile that moves sits, relative to the gap, for each swipe direction. */
const SOURCE: Readonly<Record<SwipeDirection, readonly [number, number]>> = {
  left: [1, 0],
  right: [-1, 0],
  up: [0, 1],
  down: [0, -1],
};

function swiped(state: SlidingPuzzleState, direction: SwipeDirection): SlidingPuzzleMove | null {
  const gap = state.tiles.indexOf(0);
  const [dx, dy] = SOURCE[direction];
  const col = (gap % state.size) + dx;
  const row = Math.floor(gap / state.size) + dy;
  const isInside = gap !== -1 && col >= 0 && row >= 0 && col < state.size && row < state.size;
  return isInside ? { kind: 'slide-tile', from: row * state.size + col } : null;
}

function tapped(state: SlidingPuzzleState, target: CanvasTarget): SlidingPuzzleMove | null {
  const { col, row } = target;
  const isInside = col >= 0 && row >= 0 && col < state.size && row < state.size;
  return target.regionId === 'board' && isInside
    ? { kind: 'slide-tile', from: row * state.size + col }
    : null;
}

function candidate(state: SlidingPuzzleState, intent: CanvasIntent): SlidingPuzzleMove | null {
  switch (intent.kind) {
    case 'swipe':
      return swiped(state, intent.direction);
    case 'tap':
      return tapped(state, intent.target);
    case 'long-press':
    case 'drag-end':
    case 'aim':
      return null;
  }
}

/** Pure: an intent becomes a move listMoves lists, or null. */
export function intentToMove(
  state: SlidingPuzzleState,
  intent: CanvasIntent,
): SlidingPuzzleMove | null {
  const move = candidate(state, intent);
  if (move === null) return null;
  return listMoves(state).some((listed) => listed.from === move.from) ? move : null;
}
