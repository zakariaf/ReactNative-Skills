// src/games/__GAME_ID__/levels/__GAME_ID__-levels.ts
import { toLevelEntries } from '@/core/game/level-kit/level-table';
import { packsOf } from '@/core/game/level-kit/plan-level-table';

import { __GAME_CONST___LEVEL_PLAN } from './__GAME_ID__-level-plan';
import { __GAME_CONST___SOLVER } from './__GAME_ID__-solver';
import pack1 from './pack-1.json';
import pack2 from './pack-2.json';
import pack3 from './pack-3.json';

import type { LevelsSpec } from '@/core/game/levels';
import type { __GAME_PASCAL__Move, __GAME_PASCAL__State } from '@/games/__GAME_ID__/rules/__GAME_ID__-types';

/**
 * This game's daily salt: a 16-bit number no other game of the app uses, fixed forever once the
 * daily level shipped (a new salt changes every player's daily level). The default is FNV-1a of
 * the game id folded to 16 bits; check-levels prints it in its daily-salt-shared fix.
 */
export const __GAME_CONST___DAILY_SALT = 0x7c9e;
/** The daily level uses one medium difficulty, 40 to 50 on the 0..99 level scale, fixed forever. */
export const __GAME_CONST___DAILY_DIFFICULTY = 40;

/**
 * The committed tables (written by scripts/levels/generate-levels.ts, never by hand) and the
 * modes. daily and endless match contracts/levels.json exactly (check-levels daily-mode and
 * endless-mode). This game has no endless mode; a game with one sets
 * endless: { kind: 'endless', difficulty: ENDLESS_DIFFICULTY } (100, from src/core/game/difficulty.ts).
 */
export const __GAME_CONST___LEVELS: LevelsSpec<__GAME_PASCAL__State, __GAME_PASCAL__Move> = {
  difficultyFor: __GAME_CONST___LEVEL_PLAN.difficultyFor,
  packs: packsOf(__GAME_CONST___LEVEL_PLAN),
  table: [pack1, pack2, pack3].flatMap((pack) => toLevelEntries(pack)),
  solver: __GAME_CONST___SOLVER,
  daily: {
    kind: 'daily',
    difficulty: __GAME_CONST___DAILY_DIFFICULTY,
    salt: __GAME_CONST___DAILY_SALT,
  },
  endless: { kind: 'none' },
};
