// src/services/audio/synth/ui-sounds.ts
import type { SoundRecipe } from './synthesize-recipe';

/**
 * The app-wide UI sounds (category 'ui'), one per moment in UI_FEEDBACK. Feature banks add their
 * own ids and never use the ui. namespace. Literal data: the quality gate and the WAV preview
 * read it.
 */
export const UI_SOUNDS = {
  /** A switch flips: two short sine blips, a fifth apart. */
  'ui.toggle': [
    {
      wave: 'sine',
      startHz: 660,
      endHz: 660,
      offsetMs: 0,
      durationMs: 60,
      attackMs: 2,
      gain: 0.35,
    },
    {
      wave: 'sine',
      startHz: 990,
      endHz: 990,
      offsetMs: 45,
      durationMs: 70,
      attackMs: 2,
      gain: 0.3,
    },
  ],
  /** An action succeeded: two rising triangle notes (E5, then A5). */
  'ui.success': [
    {
      wave: 'triangle',
      startHz: 659.25,
      endHz: 659.25,
      offsetMs: 0,
      durationMs: 90,
      attackMs: 2,
      gain: 0.4,
    },
    {
      wave: 'triangle',
      startHz: 880,
      endHz: 880,
      offsetMs: 80,
      durationMs: 140,
      attackMs: 2,
      gain: 0.4,
    },
  ],
  /** An action failed: two short, quiet low square blips. */
  'ui.error': [
    {
      wave: 'square',
      startHz: 220,
      endHz: 220,
      offsetMs: 0,
      durationMs: 40,
      attackMs: 2,
      gain: 0.25,
    },
    {
      wave: 'square',
      startHz: 220,
      endHz: 220,
      offsetMs: 60,
      durationMs: 40,
      attackMs: 2,
      gain: 0.25,
    },
  ],
} as const satisfies Readonly<Record<string, SoundRecipe>>;
