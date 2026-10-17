// src/features/__FEATURE__/sounds/__FEATURE__-sounds.ts
import type { SoundBank } from '@/services/audio/audio-port';

/**
 * The feature's sounds: kebab-case nouns named after what happened, each cued by the feature's cue
 * table (or a canvas track cue), composed once with the UI sounds (composeSoundBank). Literal data:
 * the quality gate and the WAV preview read it. Start from the sound design guide, then tune by ear.
 */
export const __FEATURE_SOUNDS__: SoundBank = {
  /** A task is done: a short rising triangle, a soft high blip. Most repeated, so the quietest. */
  complete: {
    category: 'sfx',
    recipe: [
      {
        wave: 'triangle',
        startHz: 660,
        endHz: 990,
        offsetMs: 0,
        durationMs: 110,
        attackMs: 2,
        gain: 0.3,
      },
      {
        wave: 'sine',
        startHz: 1320,
        endHz: 1320,
        offsetMs: 70,
        durationMs: 80,
        attackMs: 2,
        gain: 0.12,
      },
    ],
  },
  /** The day's goal is reached: three rising triangle notes C5-E5-G5, the last one longest. */
  goal: {
    category: 'sfx',
    recipe: [
      {
        wave: 'triangle',
        startHz: 523.25,
        endHz: 523.25,
        offsetMs: 0,
        durationMs: 140,
        attackMs: 4,
        gain: 0.4,
      },
      {
        wave: 'triangle',
        startHz: 659.25,
        endHz: 659.25,
        offsetMs: 110,
        durationMs: 140,
        attackMs: 4,
        gain: 0.4,
      },
      {
        wave: 'triangle',
        startHz: 783.99,
        endHz: 783.99,
        offsetMs: 220,
        durationMs: 320,
        attackMs: 4,
        gain: 0.45,
      },
    ],
  },
  /** A streak grows: a rising sine sweep over a little soft noise. */
  streak: {
    category: 'sfx',
    recipe: [
      {
        wave: 'sine',
        startHz: 300,
        endHz: 1200,
        offsetMs: 0,
        durationMs: 240,
        attackMs: 8,
        gain: 0.45,
      },
      {
        wave: 'noise',
        startHz: 0,
        endHz: 0,
        offsetMs: 0,
        durationMs: 160,
        attackMs: 4,
        gain: 0.15,
        seed: 3,
      },
    ],
  },
};
