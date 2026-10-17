// src/games/pig/levels/pig-level-plan.ts
import { create } from '@/games/pig/rules/create';
import { outcome } from '@/games/pig/rules/outcome';

import { PIG_SOLVER, WITNESS_MAX_MOVES } from './pig-solver';

import type { LevelPlan } from '@/core/game/level-kit/level-plan';
import type { PigMove, PigState } from '@/games/pig/rules/pig-types';

/** Levels per pack: contracts/levels.json says the same (packCount 2, levelsPerPack 20). */
export const LEVELS_PER_PACK = 20;
const LAST_LEVEL = 2 * LEVELS_PER_PACK;

/** A witness win in fewer moves is too easy to ship. par is only this filter, never shown. */
export const MIN_WITNESS_MOVES = 12;

/** 0 at level 1, rising evenly to 99 at the last level: every tuning row gets levels. */
export function difficultyFor(level: number): number {
  const step = Math.min(Math.max(level, 1), LAST_LEVEL) - 1;
  return Math.floor((step * 99) / (LAST_LEVEL - 1));
}

/**
 * [win, two, three]: a win needs the target (Pig's win score is at least the banked target), two
 * stars what the witness scored, three 20 % more. Whole numbers, strictly ascending.
 */
export function scoreThresholds(
  target: number,
  witnessScore: number,
): readonly [number, number, number] {
  const two = Math.max(witnessScore, target + 1);
  const three = Math.max(two + 1, Math.floor((two * 12) / 10));
  return [target, two, three];
}

export const PIG_LEVEL_PLAN: LevelPlan<PigState, PigMove> = {
  gameId: 'pig',
  packs: [
    { id: 'first-rolls', nameId: 'pig.pack-name.1' },
    { id: 'high-stakes', nameId: 'pig.pack-name.2' },
  ],
  levelsPerPack: LEVELS_PER_PACK,
  difficultyFor,
  create,
  solver: PIG_SOLVER,
  maxNodes: WITNESS_MAX_MOVES,
  // A witness loses some candidates; each loss is only a retry with the next candidate seed.
  maxTries: 60,
  rate: ({ par, final }) => {
    const result = outcome(final);
    if (result.kind !== 'won' || par < MIN_WITNESS_MOVES) return null;
    return { kind: 'score', thresholds: scoreThresholds(final.target, result.score) };
  },
};
