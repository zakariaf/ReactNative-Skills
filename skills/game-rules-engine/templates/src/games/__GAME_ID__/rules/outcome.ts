// src/games/__GAME_ID__/rules/outcome.ts
import { TUNING } from './__GAME_ID__-tuning';

import type { __GAME_PASCAL__State } from './__GAME_ID__-types';
import type { Outcome } from '@/core/game/game-engine';

export function isCleared(state: __GAME_PASCAL__State): boolean {
  return state.cells.every((cell) => cell === 0);
}

/** Won beats lost: clearing the board with the last move still wins. */
export function outcome(state: __GAME_PASCAL__State): Outcome {
  if (isCleared(state)) {
    return { kind: 'won', score: (state.maxMoves - state.moves) * TUNING.pointsPerSpareMove };
  }
  return state.moves >= state.maxMoves
    ? { kind: 'lost', reasonKey: '__GAME_ID__.lose.out-of-moves' }
    : { kind: 'playing' };
}
