// src/games/pig/rules/roll-die.ts
import { nextInt } from '@/core/rng/sfc32';

import { TUNING } from './pig-tuning';

import type { RngState } from '@/core/rng/sfc32';

/** One die roll from the stream: exactly one nextInt draw; returns the face and the next state. */
export function rollDie(rng: RngState): { readonly face: number; readonly rng: RngState } {
  const draw = nextInt(rng, TUNING.dieFaces);
  return { face: draw.value + 1, rng: draw.state };
}
