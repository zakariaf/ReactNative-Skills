// src/games/pig/levels/pig-levels.ts
import { ENDLESS_DIFFICULTY } from '@/core/game/difficulty';
import { toLevelEntries } from '@/core/game/level-kit/level-table';
import { packsOf } from '@/core/game/level-kit/plan-level-table';

import pack1 from './pack-1.json';
import pack2 from './pack-2.json';
import { PIG_LEVEL_PLAN } from './pig-level-plan';
import { PIG_SOLVER } from './pig-solver';

import type { LevelsSpec } from '@/core/game/levels';
import type { PigMove, PigState } from '@/games/pig/rules/pig-types';

/** FNV-1a of 'pig' folded to 16 bits; fixed forever once the daily level shipped. */
export const PIG_DAILY_SALT = 0x93cf;
/** The second of Pig's four tuning rows (25-49): a medium daily. */
export const PIG_DAILY_DIFFICULTY = 45;

export const PIG_LEVELS: LevelsSpec<PigState, PigMove> = {
  difficultyFor: PIG_LEVEL_PLAN.difficultyFor,
  packs: packsOf(PIG_LEVEL_PLAN),
  table: [pack1, pack2].flatMap((pack) => toLevelEntries(pack)),
  // A witness: every level was won by the fixed player and its line replays (no hints from it).
  solver: PIG_SOLVER,
  daily: { kind: 'daily', difficulty: PIG_DAILY_DIFFICULTY, salt: PIG_DAILY_SALT },
  // Pig's endless row has no target: create(freshSeed, 100) is never won, only survived.
  endless: { kind: 'endless', difficulty: ENDLESS_DIFFICULTY },
};
