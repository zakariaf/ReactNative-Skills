// src/games/pig/rules/outcome.ts
import { TUNING } from './pig-tuning';

import type { PigState } from './pig-types';
import type { Outcome } from '@/core/game/game-engine';

export function hasReachedTarget(state: PigState): boolean {
  return state.target > 0 && state.banked >= state.target;
}

/**
 * Won beats lost: a hold that reaches the target on the last turn wins. The endless run has no
 * target, so it only ever ends lost. A bust streak is checked before the turn budget, so the
 * reason names what actually ended the run.
 */
export function outcome(state: PigState): Outcome {
  if (hasReachedTarget(state)) {
    const spare = Math.max(state.maxTurns - state.turn, 0);
    return { kind: 'won', score: state.banked + spare * TUNING.pointsPerSpareTurn };
  }
  if (state.busts >= state.maxBusts) return { kind: 'lost', reasonKey: 'pig.lose.bust-streak' };
  if (state.turn >= state.maxTurns) return { kind: 'lost', reasonKey: 'pig.lose.out-of-turns' };
  return { kind: 'playing' };
}
