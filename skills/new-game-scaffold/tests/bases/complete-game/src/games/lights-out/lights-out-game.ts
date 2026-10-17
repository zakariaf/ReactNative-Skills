// src/games/lights-out/lights-out-game.ts
// Self-test stand-in: the games skills write the real file; check-game-scaffold only needs it to exist and load.
import { intentToMove } from '@/games/lights-out/canvas/intent-to-move';
import { LIGHTS_OUT_LEVELS } from '@/games/lights-out/levels/lights-out-levels';
import { LIGHTS_OUT_ENGINE, LIGHTS_OUT_RULES } from '@/games/lights-out/rules/lights-out-engine';
import { LIGHTS_OUT_PERSISTENCE } from '@/games/lights-out/rules/lights-out-persistence';
import { LIGHTS_OUT_STATS } from '@/games/lights-out/rules/lights-out-stats';
import { LIGHTS_OUT_TESTING } from '@/games/lights-out/testing/lights-out-testing';

export const LIGHTS_OUT_GAME = {
  identity: { id: 'lights-out', nameId: 'lights-out.name' },
  engine: LIGHTS_OUT_ENGINE,
  input: { panMode: 'none', selectRegions: [], intentToMove },
  rules: LIGHTS_OUT_RULES,
  persistence: LIGHTS_OUT_PERSISTENCE,
  stats: LIGHTS_OUT_STATS,
  testing: LIGHTS_OUT_TESTING,
  levels: LIGHTS_OUT_LEVELS,
};
