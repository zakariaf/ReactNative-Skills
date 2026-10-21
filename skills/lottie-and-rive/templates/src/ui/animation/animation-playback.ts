// src/ui/animation/animation-playback.ts
// Owned by the lottie-and-rive skill. The one decision every Lottie or Rive moment takes: play, or
// hold its still frame. Pure, so the whole table is tested without a native view.

/** A heavy moment (a full-screen celebration, a large mascot) shares the screen with no other heavy one. */
export type AnimationWeight = 'light' | 'heavy';

export type Playback = 'play' | 'still';

export type PlaybackInput = {
  /** useReduceMotion(): the phone's switch, the in-app setting, and a test build held still. */
  readonly isReduceMotion: boolean;
  /** The screen that shows the moment is focused and the moment is on screen. */
  readonly isActive: boolean;
  /** The app is in the foreground (useIsAppActive). */
  readonly isAppActive: boolean;
  /** A light moment always has its slot; a heavy one only while it holds the stage. */
  readonly hasSlot: boolean;
  /** A bounded moment has used every play it was given. */
  readonly isDone: boolean;
};

/** Plays only when nothing asks for stillness; any single reason holds the still frame. */
export function playbackOf(input: PlaybackInput): Playback {
  if (input.isReduceMotion || input.isDone) return 'still';
  return input.isActive && input.isAppActive && input.hasSlot ? 'play' : 'still';
}

/** The library ceiling for a bounded loop: contracts/animations.json budgets.maxPlays may be lower, never higher. */
export const MAX_PLAYS = 3;

/** True for a play count a moment may take: a whole number from 1 (a one-shot) to MAX_PLAYS. */
export function isBoundedPlays(plays: number): boolean {
  return Number.isInteger(plays) && plays >= 1 && plays <= MAX_PLAYS;
}
