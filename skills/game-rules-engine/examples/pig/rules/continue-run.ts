// src/games/pig/rules/continue-run.ts
import { outcome } from './outcome';
import { TUNING } from './pig-tuning';

import type { PigEvent, PigResult, PigState } from './pig-types';

/**
 * The one continue, from either way of losing: the bust streak is cleared and, when the turns ran
 * out, continueTurns more are added. The stream is kept: the next roll is the one that would have
 * come anyway, so a continue cannot be used to re-roll.
 */
export function continueRun(lost: PigState): PigResult {
  if (outcome(lost).kind !== 'lost') throw new RangeError('continueRun needs a lost run');
  const events: PigEvent[] = [];
  let maxTurns = lost.maxTurns;
  if (lost.turn >= lost.maxTurns) {
    maxTurns = lost.turn + TUNING.continueTurns;
    events.push({ kind: 'turns-added', count: TUNING.continueTurns });
  }
  if (lost.busts > 0) events.push({ kind: 'busts-cleared', count: lost.busts });
  return { state: { ...lost, maxTurns, busts: 0 }, events };
}
