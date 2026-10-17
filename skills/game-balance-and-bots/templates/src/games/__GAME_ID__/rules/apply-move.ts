// src/games/__GAME_ID__/rules/apply-move.ts
import { isCleared, outcome } from './outcome';
import { neighbourhood, toggleCells } from './toggle-cells';

import type {
  __GAME_PASCAL__Event,
  __GAME_PASCAL__Move,
  __GAME_PASCAL__Result,
  __GAME_PASCAL__State,
} from './__GAME_ID__-types';

function isLegal(state: __GAME_PASCAL__State, move: __GAME_PASCAL__Move): boolean {
  const isInside = move.col >= 0 && move.col < state.cols && move.row >= 0 && move.row < state.rows;
  return isInside && Number.isInteger(move.col) && Number.isInteger(move.row);
}

/**
 * Pure: the next state plus the events that explain it. An illegal move throws instead of
 * returning a corrupted state (the host only ever passes moves listMoves offered).
 */
export function applyMove(
  state: __GAME_PASCAL__State,
  move: __GAME_PASCAL__Move,
): __GAME_PASCAL__Result {
  if (outcome(state).kind !== 'playing' || !isLegal(state, move)) {
    throw new RangeError(`illegal move ${JSON.stringify(move)}`);
  }
  const toggled = neighbourhood(state.cols, state.rows, move.row * state.cols + move.col);
  const next: __GAME_PASCAL__State = {
    ...state,
    cells: toggleCells(state.cells, toggled),
    moves: state.moves + 1,
  };
  const events: __GAME_PASCAL__Event[] = [{ kind: 'cells-toggled', cells: toggled }];
  if (isCleared(next)) events.push({ kind: 'board-cleared' });
  return { state: next, events };
}
