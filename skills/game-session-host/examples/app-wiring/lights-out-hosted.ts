// src/games/lights-out/lights-out-hosted.ts
// Lights Out as the app hosts it: the game module (game-rules-engine) plus its board component
// (canvas/lights-out-board.tsx renders skia-canvas-rendering's canvas/lights-out-surface.ts) and,
// optionally, its tutorial. Assembly only: one typed constant, no logic, no app imports beyond the
// seam.
import { LightsOutBoard } from '@/games/lights-out/canvas/lights-out-board';
import { LIGHTS_OUT_GAME } from '@/games/lights-out/lights-out-game';
import { LIGHTS_OUT_TUTORIAL } from '@/games/lights-out/tutorial/lights-out-tutorial';

import type { CanvasIntent } from '@/canvas/gestures/canvas-intent';
import type {
  LightsOutEvent,
  LightsOutMove,
  LightsOutState,
} from '@/games/lights-out/rules/lights-out-types';
import type { HostedGame } from '@/services/game-host/hosted-game';

export const LIGHTS_OUT_HOSTED: HostedGame<
  LightsOutState,
  LightsOutMove,
  LightsOutEvent,
  CanvasIntent
> = {
  ...LIGHTS_OUT_GAME,
  Surface: LightsOutBoard,
  tutorial: LIGHTS_OUT_TUTORIAL,
};
