// src/games/lights-out/lights-out-game.ts
// The game module: everything the app needs from Lights Out, as one value. Assembly only; every
// member comes from the rules, the canvas surface and the testing file. Written once the surface's
// intent function exists (canvas-gestures-and-hit-testing); the session host (game-session-host)
// adds the surface itself by intersection.
import { intentToMove } from '@/games/lights-out/canvas/intent-to-move';
import { LIGHTS_OUT_ENGINE, LIGHTS_OUT_RULES } from '@/games/lights-out/rules/lights-out-engine';
import { LIGHTS_OUT_PERSISTENCE } from '@/games/lights-out/rules/lights-out-persistence';
import { LIGHTS_OUT_STATS } from '@/games/lights-out/rules/lights-out-stats';
import { LIGHTS_OUT_TESTING } from '@/games/lights-out/testing/lights-out-testing';

import type { CanvasIntent } from '@/canvas/gestures/canvas-intent';
import type { GameModule } from '@/core/game/game-module';
import type {
  LightsOutEvent,
  LightsOutMove,
  LightsOutState,
} from '@/games/lights-out/rules/lights-out-types';

export const LIGHTS_OUT_GAME: GameModule<
  LightsOutState,
  LightsOutMove,
  LightsOutEvent,
  CanvasIntent
> = {
  identity: { id: 'lights-out', nameId: 'lights-out.name' },
  engine: LIGHTS_OUT_ENGINE,
  input: {
    // Taps only: the surface sends no pan intents ('swipe', 'drag' or 'aim' for games that use them).
    panMode: 'none',
    // Every tap acts: no region selects first (a tray of pieces would: ['tray']).
    selectRegions: [],
    intentToMove,
  },
  rules: LIGHTS_OUT_RULES,
  persistence: LIGHTS_OUT_PERSISTENCE,
  stats: LIGHTS_OUT_STATS,
  testing: LIGHTS_OUT_TESTING,
  // No shipped levels yet: level-generation-and-solvers fills this in.
  levels: null,
};
