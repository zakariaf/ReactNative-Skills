// src/services/game-host/play-clock.ts

/** Longest play time one step may add (a clock jump or a sleeping phone never adds hours). */
export const MAX_PLAY_DELTA_MS = 300_000;

/** Measures the time between two session commands; only time spent playing counts. */
export type PlayClock = {
  /** Milliseconds since the previous lap if the run was playing all that time, else 0. */
  readonly lap: (wasPlaying: boolean) => number;
};

/**
 * The run's play-time meter. The status changes only through commands, so the status seen at a
 * command held for the whole interval before it: pause, the background and the result screen
 * stop the count, and every step is clamped to 0..MAX_PLAY_DELTA_MS (a clock set back adds 0).
 */
export function createPlayClock(nowMs: () => number): PlayClock {
  let markMs = nowMs();
  return {
    lap: (wasPlaying) => {
      const now = nowMs();
      const elapsed = now - markMs;
      markMs = now;
      return wasPlaying ? Math.min(Math.max(elapsed, 0), MAX_PLAY_DELTA_MS) : 0;
    },
  };
}
