// src/games/pig/rules/create.ts
import { clampDifficulty } from '@/core/game/difficulty';
import { seedRng } from '@/core/rng/sfc32';

import { TUNING, knobsFor } from './pig-tuning';

import type { PigState } from './pig-types';

/** Nothing is drawn yet: the warmed-up stream goes into the state for the rolls to come. */
export function create(seed: number, difficulty: number): PigState {
  const level = clampDifficulty(difficulty);
  const { target, maxTurns } = knobsFor(level);
  return {
    difficulty: level,
    target,
    banked: 0,
    turnTotal: 0,
    turn: 0,
    maxTurns,
    busts: 0,
    maxBusts: TUNING.maxBusts,
    rng: seedRng(seed),
  };
}
