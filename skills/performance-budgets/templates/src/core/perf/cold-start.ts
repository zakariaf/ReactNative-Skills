// src/core/perf/cold-start.ts
// One launch, split in two: process start -> the JS entry mark (native start-up: process creation,
// libraries, React Native, the bundle) and the JS entry mark -> the first screen drawn with data.

/**
 * A process start more than this before the JS entry cannot belong to the launch being measured:
 * the system created the process earlier (iOS prewarming, an Android start by a push, a broadcast or
 * a job on a version that does not say so) and the user's launch only resumed it.
 */
export const STALE_PROCESS_START_MS = 10_000;

export type ColdStartReport = {
  /** Process start -> JS entry; null when the native module answered nothing (Jest, web). */
  readonly nativeMs: number | null;
  /** JS entry -> the first screen drawn with real data. */
  readonly jsMs: number;
  /** Process start -> first screen: the number perf.coldStartHomeMsMax applies to. */
  readonly totalMs: number | null;
  /**
   * True when the process started before this launch (the OS said so, or nativeMs is over
   * STALE_PROCESS_START_MS); check-perf-report.mjs leaves such launches out of the median.
   */
  readonly prewarmed: boolean;
};

export type ColdStartMarks = {
  readonly processStartEpochMs: number | null;
  readonly jsEntryEpochMs: number;
  readonly firstScreenEpochMs: number;
  /** What the native module says: iOS prewarming, or an Android 15+ start that was not a launch. */
  readonly isPrewarmed: boolean;
};

/** The native, JS and total parts of one launch from its marks. */
export function coldStartReport(marks: ColdStartMarks): ColdStartReport {
  const { processStartEpochMs: start, jsEntryEpochMs: jsEntry, firstScreenEpochMs: screen } = marks;
  const nativeMs = start === null ? null : jsEntry - start;
  return {
    nativeMs,
    jsMs: screen - jsEntry,
    totalMs: start === null ? null : screen - start,
    prewarmed: marks.isPrewarmed || (nativeMs !== null && nativeMs > STALE_PROCESS_START_MS),
  };
}
