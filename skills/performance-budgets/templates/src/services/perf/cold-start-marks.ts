// src/services/perf/cold-start-marks.ts
// The two JS marks of a launch, held for exactly one JS runtime: a reload (a direction restart, an
// OTA update) starts a new runtime, which marks again. A plain in-memory value, written by calls,
// never at import time.
import { coldStartReport } from '@/core/perf/cold-start';

import type { ColdStartReport } from '@/core/perf/cold-start';

let jsEntryEpochMs: number | null = null;
let isReported = false;

/**
 * Called once, in the root layout's first render (the startup decision), with perf.epochMs().
 * Later calls keep the first mark.
 */
export function markJsEntry(nowEpochMs: number): void {
  jsEntryEpochMs ??= nowEpochMs;
}

/** What the perf port reads when the first screen is drawn. */
export type FirstScreenReading = {
  readonly nowEpochMs: number;
  readonly processStartEpochMs: number | null;
  readonly isPrewarmed: boolean;
};

/**
 * The first screen drawn with data: returns the launch's report once per runtime, then null (a warm
 * return to that screen is not a cold start). Null too when markJsEntry never ran.
 */
export function takeColdStartReport(reading: FirstScreenReading): ColdStartReport | null {
  if (isReported || jsEntryEpochMs === null) return null;
  isReported = true;
  return coldStartReport({
    processStartEpochMs: reading.processStartEpochMs,
    jsEntryEpochMs,
    firstScreenEpochMs: reading.nowEpochMs,
    isPrewarmed: reading.isPrewarmed,
  });
}
