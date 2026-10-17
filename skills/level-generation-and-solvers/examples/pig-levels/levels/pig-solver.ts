// src/games/pig/levels/pig-solver.ts
// Pig draws every roll during play, so no exact search fits: a witness proves each level. The
// game's reasonable player plays it from a fixed seed; its win is the proof, and the levels
// contract test replays the line through the real engine.
import { createWitnessSolver } from '@/core/game/solver/witness-solver';
import { PIG_ENGINE } from '@/games/pig/rules/pig-engine';
import { holdAtTwentyPolicy } from '@/games/pig/rules/pig-hold-policy';

import type { Solver } from '@/core/game/levels';
import type { PigMove, PigState } from '@/games/pig/rules/pig-types';

/** Seeds the witness's own tie-breaks. Fixed forever: a new seed or policy regenerates the packs. */
export const WITNESS_BOT_SEED = 0x2f1d;

/** Legal moves the witness may be shown in total: far above a whole won level (about 150). */
export const WITNESS_MAX_MOVES = 2_000;

export const PIG_SOLVER: Solver<PigState, PigMove> = createWitnessSolver({
  rules: PIG_ENGINE,
  policy: holdAtTwentyPolicy,
  botSeed: WITNESS_BOT_SEED,
});
