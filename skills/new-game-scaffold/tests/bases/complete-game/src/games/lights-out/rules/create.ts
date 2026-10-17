// src/games/lights-out/rules/create.ts
// Self-test stand-in: the games skills write the real file; check-game-scaffold only needs it to exist and load.
import { LIGHTS_OUT_TUNING } from '@/games/lights-out/rules/lights-out-tuning';

import type { LightsOutState } from '@/games/lights-out/rules/lights-out-types';

export function create(): LightsOutState {
  return { lit: [0, 2], movesLeft: LIGHTS_OUT_TUNING.movesPerLevel };
}
