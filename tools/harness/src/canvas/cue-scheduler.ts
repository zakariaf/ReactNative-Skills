// src/canvas/cue-scheduler.ts
import type { HapticCue, Track } from './timeline/track';

/**
 * What the scheduler needs of the app's audio and haptics ports. Structural on purpose: the
 * AudioPort and HapticsPort from audio-and-haptics-feedback satisfy these as they are.
 */
export type CueAudio = {
  /** Plays a sound from the app's sound set after delayMs, on the audio clock. */
  readonly play: (soundId: string, delayMs?: number) => void;
  /** Drops every sound scheduled but not yet heard. */
  readonly cancelPending: () => void;
};
export type CueHaptics = { readonly play: (cue: HapticCue) => void };

export type CueScheduler = {
  /** Fires every track cue at the track's start: sounds on the audio clock, haptics via timers. */
  readonly schedule: (tracks: readonly Track[]) => void;
  /** Drops everything not yet fired (fast-forward, pause, leaving the screen). */
  readonly cancel: () => void;
};

export function createCueScheduler(audio: CueAudio, haptics: CueHaptics): CueScheduler {
  let timers: ReturnType<typeof setTimeout>[] = [];
  const cancel = (): void => {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
    audio.cancelPending();
  };
  const schedule = (tracks: readonly Track[]): void => {
    for (const { cue, startMs } of tracks) {
      if (cue?.sound !== undefined) audio.play(cue.sound, startMs);
      const haptic = cue?.haptic;
      if (haptic === undefined) continue;
      if (startMs <= 0) haptics.play(haptic);
      else
        timers.push(
          setTimeout(() => {
            haptics.play(haptic);
          }, startMs),
        );
    }
  };
  return { schedule, cancel };
}
