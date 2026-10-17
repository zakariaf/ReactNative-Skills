// scripts/build/ready-signal.ts
// When the launched app counts as ready for its screenshot. Never a fixed sleep: builds and Macs
// vary, so the run polls. A data signal wins: a marker file the test build writes into its data
// container once the first screen is interactive (contracts/ios-sim-build.json readyMarker). Without
// one, two byte-identical screenshots in a row mean the screen has settled.

/** One poll of the running app. */
export type ReadyProbe = {
  /** 1-based poll number, READY_POLL_MS apart. */
  readonly attempt: number;
  /** The marker file's text, or null when no marker is configured or the file does not exist. */
  readonly marker: string | null;
  /** What the marker must contain (contracts readyMarker.contains). */
  readonly contains: string | null;
  /** This screenshot is byte-identical to the previous one. */
  readonly screenUnchanged: boolean;
};

/** Poll every 500 ms... */
export const READY_POLL_MS = 500;
/** ...for at most 30 s. */
export const READY_MAX_ATTEMPTS = 60;
/** A still screen counts after at least 3 s. */
const MIN_ATTEMPTS_FOR_STABLE_SCREEN = 6;
/**
 * A marker file without the expected text means the app is up but its first screen is not the one
 * that marks (a first-run screen, a sign-in): give it 8 s before a still screen counts.
 */
const MIN_ATTEMPTS_WITH_MARKER_PENDING = 16;

/** 'marker', 'stable-screen' or null (keep polling). */
export function readyReason(probe: ReadyProbe): 'marker' | 'stable-screen' | null {
  if (probe.marker !== null && probe.contains !== null && probe.marker.includes(probe.contains)) {
    return 'marker';
  }
  const minAttempts =
    probe.marker === null ? MIN_ATTEMPTS_FOR_STABLE_SCREEN : MIN_ATTEMPTS_WITH_MARKER_PENDING;
  return probe.attempt >= minAttempts && probe.screenUnchanged ? 'stable-screen' : null;
}
