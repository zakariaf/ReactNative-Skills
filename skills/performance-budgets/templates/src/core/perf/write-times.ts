// src/core/perf/write-times.ts
// The storage-write benchmark: the app's heaviest per-change write, timed many times after a warm-up.
// Pure: the write and the clock arrive as functions (the Jest guard passes node:perf_hooks, a test
// build passes the perf port's high-resolution clock).
import type { PerfEntry } from './perf-entry';

export const STORAGE_BENCHMARK_WRITES = 300;
export const STORAGE_BENCHMARK_WARMUP = 20;

export type WriteTimes = {
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  /** How many writes were timed; a report without it cannot say what the percentiles mean. */
  readonly writes: number;
};

/** Nearest-rank percentile of ascending samples (NaN for none). */
export function percentile(sortedMs: readonly number[], p: number): number {
  const index = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1);
  return sortedMs[index] ?? Number.NaN;
}

/** p50, p95 and max of the measured write times, rounded to 0.01 ms, and their count. */
export function summarizeWriteTimes(samplesMs: readonly number[]): WriteTimes {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const round = (ms: number): number => Math.round(ms * 100) / 100;
  return {
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    max: round(sorted.at(-1) ?? Number.NaN),
    writes: sorted.length,
  };
}

export type StorageBenchmarkInput = {
  /** One per-change write of the app's largest realistic data, committed when it returns. */
  readonly write: (index: number) => void;
  /** A high-resolution clock in ms. */
  readonly now: () => number;
  readonly writes?: number;
  readonly warmup?: number;
};

/** Runs warm-up writes, then times each of `writes` writes. */
export function runStorageBenchmark(input: StorageBenchmarkInput): WriteTimes {
  const writes = input.writes ?? STORAGE_BENCHMARK_WRITES;
  const warmup = input.warmup ?? STORAGE_BENCHMARK_WARMUP;
  const samples: number[] = [];
  for (let index = 0; index < warmup + writes; index += 1) {
    const start = input.now();
    input.write(index);
    if (index >= warmup) samples.push(input.now() - start);
  }
  return summarizeWriteTimes(samples);
}

/** The perf-log entry of one run: { kind: 'storage-benchmark', label: 'storage-write', data }. */
export function storageBenchmarkEntry(
  times: WriteTimes,
  atEpochMs: number,
  build: string,
): PerfEntry {
  return {
    kind: 'storage-benchmark',
    label: 'storage-write',
    atEpochMs,
    build,
    data: { ...times },
  };
}
