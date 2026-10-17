// src/services/test-hooks/recording-feedback.ts
// Test builds only: it lives in a test-only folder (contracts/architecture.json testOnlyFolders) and
// is reached only through the app's test-only gate: src/test-only-entry.ts re-exports
// recordAudioFeedback and recordHapticsFeedback, and the startup wraps the audio and haptics ports
// with TEST_ONLY?.recordAudioFeedback the way the clock is wrapped (debug-menu-and-test-hooks), so
// release bundles contain none of it. Each sound and pulse passes through unchanged and is also
// handed to `record`, which a test build writes where its E2E run can read it: the evidence that the
// app asked for the feedback. How it sounds and feels stays a human check on a real phone.
import type { AudioPort } from '@/services/audio/audio-port';
import type { HapticCue, HapticsPort } from '@/services/haptics/haptics-port';

export type FeedbackEntry = {
  readonly kind: 'feedback';
  /** The sound id ('ui.success', a feature sound) or the haptic cue ('success'). */
  readonly label: string;
  readonly atMs: number;
  /** Sounds carry their scheduling delay; pulses carry nothing. */
  readonly data: Readonly<Record<string, number>>;
};

export type FeedbackRecorder = {
  readonly record: (entry: FeedbackEntry) => void;
  /** The test build's clock (ClockPort.nowMs). */
  readonly nowMs: () => number;
};

/** @public The same AudioPort, with every play request also recorded. */
export function recordAudioFeedback(audio: AudioPort, recorder: FeedbackRecorder): AudioPort {
  return {
    ...audio,
    play: (soundId, delayMs = 0) => {
      audio.play(soundId, delayMs);
      recorder.record({
        kind: 'feedback',
        label: soundId,
        atMs: recorder.nowMs(),
        data: { delayMs },
      });
    },
  };
}

/** @public The same HapticsPort, with every cue also recorded. */
export function recordHapticsFeedback(
  haptics: HapticsPort,
  recorder: FeedbackRecorder,
): HapticsPort {
  return {
    isSupported: haptics.isSupported,
    play: (cue: HapticCue) => {
      haptics.play(cue);
      recorder.record({ kind: 'feedback', label: cue, atMs: recorder.nowMs(), data: {} });
    },
  };
}
