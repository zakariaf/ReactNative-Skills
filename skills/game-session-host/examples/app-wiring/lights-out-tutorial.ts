// src/games/lights-out/tutorial/lights-out-tutorial.ts
// Lights Out's scripted first run (optional): pure data the hosted binding joins to the module.
// It starts from a 3x3 board lit by pressing both corners, so step 1 presses the top-left corner and
// step 2 the bottom-right one: every light goes out and the run is won. A step could also say
// { kind: 'any-move' }. The moves are the game's own LightsOutMove values (game-rules-engine);
// game-session-host's checker replays every step headless and fails one the rules do not list as
// legal at that point (tutorial-legal).
import { LIGHTS_OUT_GAME } from '@/games/lights-out/lights-out-game';

import type { LightsOutMove, LightsOutState } from '@/games/lights-out/rules/lights-out-types';
import type { TutorialSpec } from '@/services/game-host/hosted-game';

/** Rows x x . / x . x / . x x: the two corner presses, row-major. */
const LIT_BY_CORNERS = [1, 1, 0, 1, 0, 1, 0, 1, 1] as const;

/** The game's start example reshaped to the tutorial's 3x3 board. */
function tutorialStart(): LightsOutState {
  const start = LIGHTS_OUT_GAME.testing.examples.start();
  return { ...start, cols: 3, rows: 3, cells: LIT_BY_CORNERS, moves: 0 };
}

export const LIGHTS_OUT_TUTORIAL: TutorialSpec<LightsOutState, LightsOutMove> = {
  start: tutorialStart,
  steps: [
    {
      messageId: 'lights-out.tutorial.tap-first',
      expect: { kind: 'move', move: { kind: 'toggle', col: 0, row: 0 } },
    },
    {
      messageId: 'lights-out.tutorial.tap-last',
      expect: { kind: 'move', move: { kind: 'toggle', col: 2, row: 2 } },
    },
  ],
};
