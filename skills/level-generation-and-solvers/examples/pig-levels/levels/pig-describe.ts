// src/games/pig/levels/pig-describe.ts
// A Pig level start as golden text: the target, the turn and bust budgets, and the first rolls its
// stream holds, so a changed stream or tuning shows up as a readable diff.
import { rollDie } from '@/games/pig/rules/roll-die';

import type { PigState } from '@/games/pig/rules/pig-types';

const PREVIEW_ROLLS = 8;

export function describeLevel(state: PigState): string {
  const faces: number[] = [];
  let rng = state.rng;
  for (let index = 0; index < PREVIEW_ROLLS; index += 1) {
    const roll = rollDie(rng);
    faces.push(roll.face);
    rng = roll.rng;
  }
  const budgets = `target ${String(state.target)} turns ${String(state.maxTurns)} busts ${String(state.maxBusts)}`;
  return `${budgets}\nrolls ${faces.join(',')}`;
}
