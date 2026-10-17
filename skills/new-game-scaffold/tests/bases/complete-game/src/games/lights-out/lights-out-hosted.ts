// src/games/lights-out/lights-out-hosted.ts
// Self-test stand-in: game-session-host writes the real file (the module plus its board component
// from canvas/<id>-board.tsx); check-game-scaffold only needs it to exist.
import { LightsOutBoard } from '@/games/lights-out/canvas/lights-out-board';
import { LIGHTS_OUT_GAME } from '@/games/lights-out/lights-out-game';

export const LIGHTS_OUT_HOSTED = { ...LIGHTS_OUT_GAME, Surface: LightsOutBoard };
