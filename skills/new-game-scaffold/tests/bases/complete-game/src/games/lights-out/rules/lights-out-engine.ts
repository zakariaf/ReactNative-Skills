// src/games/lights-out/rules/lights-out-engine.ts
// Self-test stand-in: the games skills write the real file; check-game-scaffold only needs it to exist and load.
import { applyMove } from '@/games/lights-out/rules/apply-move';
import { create } from '@/games/lights-out/rules/create';
import { listMoves } from '@/games/lights-out/rules/list-moves';
import { outcome } from '@/games/lights-out/rules/outcome';

export const LIGHTS_OUT_ENGINE = { create, listMoves, applyMove, outcome };
export const LIGHTS_OUT_RULES = {
  hud: () => ({ score: 0, goal: { id: 'lights-out.name' } }),
  undo: { kind: 'unlimited' },
  hints: { kind: 'none' },
  continueRun: { kind: 'once', apply: (state: unknown) => state },
};
