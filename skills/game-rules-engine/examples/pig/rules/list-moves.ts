// src/games/pig/rules/list-moves.ts
import { outcome } from './outcome';

import type { PigMove, PigState } from './pig-types';

/** Roll, then hold once the turn has points to bank. Fixed order; empty when the run is over. */
export function listMoves(state: PigState): PigMove[] {
  if (outcome(state).kind !== 'playing') return [];
  return state.turnTotal > 0 ? [{ kind: 'roll' }, { kind: 'hold' }] : [{ kind: 'roll' }];
}
