// src/games/pig/rules/apply-move.ts
import { listMoves } from './list-moves';
import { hasReachedTarget } from './outcome';
import { TUNING } from './pig-tuning';
import { rollDie } from './roll-die';

import type { PigEvent, PigMove, PigResult, PigState } from './pig-types';

function roll(state: PigState): PigResult {
  const { face, rng } = rollDie(state.rng);
  const rolled: PigEvent = { kind: 'die-rolled', face };
  if (face !== TUNING.bustFace) {
    return { state: { ...state, rng, turnTotal: state.turnTotal + face }, events: [rolled] };
  }
  const busts = state.busts + 1;
  const next: PigState = { ...state, rng, turnTotal: 0, turn: state.turn + 1, busts };
  return {
    state: next,
    events: [rolled, { kind: 'turn-busted', lostPoints: state.turnTotal, busts }],
  };
}

function hold(state: PigState): PigResult {
  const banked = state.banked + state.turnTotal;
  const next: PigState = { ...state, banked, turnTotal: 0, turn: state.turn + 1, busts: 0 };
  const events: PigEvent[] = [{ kind: 'turn-banked', points: state.turnTotal, banked }];
  if (hasReachedTarget(next)) events.push({ kind: 'target-reached', banked });
  return { state: next, events };
}

/** Pure; the roll draws from state.rng and the next state carries the advanced stream. */
export function applyMove(state: PigState, move: PigMove): PigResult {
  if (!listMoves(state).some((listed) => listed.kind === move.kind)) {
    throw new RangeError(`illegal move ${JSON.stringify(move)}`);
  }
  return move.kind === 'roll' ? roll(state) : hold(state);
}
