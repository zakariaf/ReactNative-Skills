// src/games/pig/rules/pig-engine.ts
import { applyMove } from './apply-move';
import { continueRun } from './continue-run';
import { create } from './create';
import { listMoves } from './list-moves';
import { outcome } from './outcome';

import type { PigEvent, PigMove, PigState } from './pig-types';
import type { GameEngine } from '@/core/game/game-engine';
import type { GameRules } from '@/core/game/game-rules';

export const PIG_ENGINE: GameEngine<PigState, PigMove, PigEvent> = {
  create,
  listMoves,
  applyMove,
  outcome,
};

export const PIG_RULES: GameRules<PigState, PigMove, PigEvent> = {
  hud: (state) => {
    const turnsLeft = Math.max(state.maxTurns - state.turn, 0);
    return state.target > 0
      ? {
          score: state.banked,
          goal: {
            id: 'pig.hud.target',
            values: { banked: state.banked, target: state.target, turnsLeft },
          },
        }
      : { score: state.banked, goal: { id: 'pig.hud.endless', values: { turnsLeft } } };
  },
  // Undo would let a player take back a roll and hold instead: a dice game has none.
  undo: { kind: 'none' },
  // The future is drawn from the stream, so there is no exact solver to suggest from.
  hints: { kind: 'none' },
  continueRun: { kind: 'once', descriptionId: 'pig.continue.extra-turns', apply: continueRun },
};
