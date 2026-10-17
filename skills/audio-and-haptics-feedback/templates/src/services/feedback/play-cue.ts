// src/services/feedback/play-cue.ts
import type { AudioPort } from '@/services/audio/audio-port';
import type { HapticCue, HapticsPort } from '@/services/haptics/haptics-port';

/** One row of a cue table: what an event sounds and feels like (either part may be absent). */
export type FeedbackCue = { readonly sound?: string; readonly haptic?: HapticCue };

/** The two ports a cue plays through (a subset of the app's Services). */
export type FeedbackPorts = { readonly audio: AudioPort; readonly haptics: HapticsPort };

/** Plays one cue now; the ports apply the user's settings, the voice policy and the throttle. */
export function playCue(ports: FeedbackPorts, cue: FeedbackCue): void {
  if (cue.sound !== undefined) ports.audio.play(cue.sound);
  if (cue.haptic !== undefined) ports.haptics.play(cue.haptic);
}
