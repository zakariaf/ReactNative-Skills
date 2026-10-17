// src/games/arena-chase/sounds/arena-chase-sounds.ts (stand-in game bank)
import type { SoundBank } from '@/services/audio/audio-port';

export const ARENA_CHASE_SOUNDS: SoundBank = {
  caught: {
    category: 'sfx',
    minIntervalMs: 60,
    recipe: [
      {
        wave: 'square',
        startHz: 180,
        endHz: 90,
        offsetMs: 0,
        durationMs: 120,
        attackMs: 2,
        gain: 0.3,
      },
    ],
  },
};
