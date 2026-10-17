// src/core/perf/frame-report.ts
import { BUCKET_BOUNDS_MS } from './frame-histogram';

import type { FrameHistogram, RefreshHz } from './frame-histogram';

export type FrameReport = {
  readonly frames: number;
  readonly seconds: number;
  readonly refreshHz: RefreshHz;
  /** Bucket upper bounds (9, 17, 25, 34, 50, 100); Infinity (JSON null) above the last one. */
  readonly p50UpToMs: number;
  readonly p95UpToMs: number;
  readonly maxMs: number;
  /** Apple's metric, ms of hitch per second: good <= 10, warning <= 25, critical <= 50. */
  readonly hitchMsPerS: number;
  readonly buckets: readonly number[];
};

/**
 * The display's rate from the shortest interval, split midway between neighbouring rates: a
 * 120 Hz frame is 8.3 ms, a 90 Hz frame 11.1 ms, a 60 Hz frame 16.7 ms.
 */
export function refreshRateOf(minIntervalMs: number): RefreshHz {
  if (minIntervalMs < 9.7) return 120;
  if (minIntervalMs < 13.9) return 90;
  return 60;
}

function percentileBound(buckets: readonly number[], frames: number, p: number): number {
  let seen = 0;
  for (const [index, count] of buckets.entries()) {
    seen += count;
    if (seen >= (p / 100) * frames) return BUCKET_BOUNDS_MS[index] ?? Number.POSITIVE_INFINITY;
  }
  return Number.POSITIVE_INFINITY;
}

function hitchMsAt(histogram: FrameHistogram, refreshHz: RefreshHz): number {
  if (refreshHz === 120) return histogram.hitchMs120;
  return refreshHz === 90 ? histogram.hitchMs90 : histogram.hitchMs60;
}

/** Pure, JS thread: turns a finished histogram into the numbers a report carries (null: no frame). */
export function summarizeFrames(histogram: FrameHistogram): FrameReport | null {
  if (histogram.frames === 0) return null;
  const refreshHz = refreshRateOf(histogram.minMs);
  const seconds = histogram.totalMs / 1000;
  return {
    frames: histogram.frames,
    seconds: Math.round(seconds * 10) / 10,
    refreshHz,
    p50UpToMs: percentileBound(histogram.buckets, histogram.frames, 50),
    p95UpToMs: percentileBound(histogram.buckets, histogram.frames, 95),
    maxMs: Math.round(histogram.maxMs),
    hitchMsPerS: Math.round((hitchMsAt(histogram, refreshHz) / seconds) * 10) / 10,
    buckets: [...histogram.buckets],
  };
}
