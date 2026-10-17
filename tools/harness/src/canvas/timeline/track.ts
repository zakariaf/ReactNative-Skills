// src/canvas/timeline/track.ts
'worklet';

/** Easing names; implemented with polynomials only (see ease()). */
export type EasingId = 'linear' | 'in-quad' | 'out-quad' | 'in-out-quad' | 'out-cubic' | 'out-back';

/** The haptic vocabulary a cue may ask for (a HapticsPort maps it to the platform). */
export type HapticCue =
  'selection' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

/** Fired once when the track starts. `sound` is an id from the app's sound set. */
export type TrackCue = { readonly sound?: string; readonly haptic?: HapticCue };

/**
 * One animated property of one entity. `from`/`to` are equal-length number vectors (x/y, alpha,
 * a colour index...); the sampler interpolates them component by component.
 */
export type Track = {
  readonly channel: string;
  readonly entityId: number;
  readonly startMs: number;
  readonly durationMs: number;
  readonly easing: EasingId;
  readonly from: readonly number[];
  readonly to: readonly number[];
  readonly cue?: TrackCue;
};

/** 'reduced' when Reduce motion is on: no shake, no particles, no overshoot, shorter tweens. */
export type Motion = 'full' | 'reduced';

/** Polynomial easings only: exact +, -, * replay identically in Jest, Node and on device. */
export function ease(easing: EasingId, p: number): number {
  switch (easing) {
    case 'linear':
      return p;
    case 'in-quad':
      return p * p;
    case 'out-quad':
      return p * (2 - p);
    case 'in-out-quad':
      return p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
    case 'out-cubic': {
      const q = p - 1;
      return q * q * q + 1;
    }
    case 'out-back': {
      const q = p - 1;
      return q * q * (2.70158 * q + 1.70158) + 1;
    }
  }
}

/** When the last track ends: the scene is "done" at this elapsed time. */
export function timelineEndMs(tracks: readonly Track[]): number {
  let end = 0;
  for (const track of tracks) {
    end = Math.max(end, track.startMs + track.durationMs);
  }
  return end;
}
