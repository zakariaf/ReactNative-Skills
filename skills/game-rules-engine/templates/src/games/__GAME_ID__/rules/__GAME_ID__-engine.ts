// src/games/__GAME_ID__/rules/__GAME_ID__-engine.ts
// The pure halves of the game module: the four engine functions and the rules members. Assembly
// only; the input members (panMode, selectRegions, intentToMove) join them in the module file
// src/games/__GAME_ID__/__GAME_ID__-game.ts once the canvas surface exists.
import { applyMove } from './apply-move';
import { create } from './create';
import { TUNING } from './__GAME_ID__-tuning';
import { listMoves } from './list-moves';
import { outcome } from './outcome';

import type {
  __GAME_PASCAL__Event,
  __GAME_PASCAL__Move,
  __GAME_PASCAL__State,
} from './__GAME_ID__-types';
import type { GameEngine } from '@/core/game/game-engine';
import type { GameRules } from '@/core/game/game-rules';

export const __GAME_CONST___ENGINE: GameEngine<
  __GAME_PASCAL__State,
  __GAME_PASCAL__Move,
  __GAME_PASCAL__Event
> = { create, listMoves, applyMove, outcome };

/** The rules beyond the engine: the top-bar line, undo, hints and the one continue. */
export const __GAME_CONST___RULES: GameRules<
  __GAME_PASCAL__State,
  __GAME_PASCAL__Move,
  __GAME_PASCAL__Event
> = {
  hud: (state) => ({
    score: 0,
    goal: {
      id: '__GAME_ID__.hud.moves',
      values: { moves: state.moves, maxMoves: state.maxMoves },
    },
  }),
  undo: { kind: 'unlimited' },
  hints: { kind: 'none' },
  continueRun: {
    kind: 'once',
    descriptionId: '__GAME_ID__.continue.more-moves',
    apply: (lost) => ({
      state: { ...lost, maxMoves: lost.moves + TUNING.continueMoves },
      events: [{ kind: 'moves-added', count: TUNING.continueMoves }],
    }),
  },
};
