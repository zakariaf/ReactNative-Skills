// src/core/perf/frame-histogram.ts
'worklet';

/** Upper bounds (ms) of the buckets; the last bucket holds everything slower. */
export const BUCKET_BOUNDS_MS = [9, 17, 25, 34, 50, 100] as const;

/** The display rates a report can name: 120 Hz (ProMotion, many Android phones), 90 Hz, 60 Hz. */
export type RefreshHz = 120 | 90 | 60;

const FRAME_MS_120 = 1000 / 120;
const FRAME_MS_90 = 1000 / 90;
const FRAME_MS_60 = 1000 / 60;

/**
 * Frame intervals recorded while something animates. Hitch time is kept for every rate, because
 * the rate is known only at the end (from the shortest interval): Σ max(0, dt − frame budget).
 */
export type FrameHistogram = {
  readonly buckets: readonly number[];
  readonly frames: number;
  readonly totalMs: number;
  readonly maxMs: number;
  readonly minMs: number;
  readonly hitchMs120: number;
  readonly hitchMs90: number;
  readonly hitchMs60: number;
};

/** An empty histogram: the start of every recording. */
export function createFrameHistogram(): FrameHistogram {
  return {
    buckets: [0, 0, 0, 0, 0, 0, 0],
    frames: 0,
    totalMs: 0,
    maxMs: 0,
    minMs: Number.POSITIVE_INFINITY,
    hitchMs120: 0,
    hitchMs90: 0,
    hitchMs60: 0,
  };
}

function bucketIndex(dtMs: number): number {
  for (let index = 0; index < BUCKET_BOUNDS_MS.length; index += 1) {
    if (dtMs <= (BUCKET_BOUNDS_MS[index] ?? 0)) return index;
  }
  return BUCKET_BOUNDS_MS.length;
}

/** Pure; runs on the UI thread once per frame while recording. A first frame (0 or less) is skipped. */
export function recordFrame(histogram: FrameHistogram, dtMs: number): FrameHistogram {
  if (dtMs <= 0) return histogram;
  const index = bucketIndex(dtMs);
  return {
    buckets: histogram.buckets.map((count, i) => (i === index ? count + 1 : count)),
    frames: histogram.frames + 1,
    totalMs: histogram.totalMs + dtMs,
    maxMs: Math.max(histogram.maxMs, dtMs),
    minMs: Math.min(histogram.minMs, dtMs),
    hitchMs120: histogram.hitchMs120 + Math.max(0, dtMs - FRAME_MS_120),
    hitchMs90: histogram.hitchMs90 + Math.max(0, dtMs - FRAME_MS_90),
    hitchMs60: histogram.hitchMs60 + Math.max(0, dtMs - FRAME_MS_60),
  };
}
