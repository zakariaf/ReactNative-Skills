// src/core/perf/write-times.test.ts
import {
  STORAGE_BENCHMARK_WARMUP,
  STORAGE_BENCHMARK_WRITES,
  percentile,
  runStorageBenchmark,
  storageBenchmarkEntry,
  summarizeWriteTimes,
} from './write-times';

describe('summarizeWriteTimes', () => {
  it('summarizes p50, p95 and max of the write times, and how many writes were timed', () => {
    const samples = Array.from({ length: 100 }, (_, i) => (i + 1) / 10);
    expect(summarizeWriteTimes(samples)).toStrictEqual({ p50: 5, p95: 9.5, max: 10, writes: 100 });
  });

  it('gives NaN percentiles for no samples', () => {
    expect(percentile([], 95)).toBeNaN();
  });
});

describe('runStorageBenchmark', () => {
  it('times only the writes after the warm-up', () => {
    const written: number[] = [];
    let clock = 0;
    const result = runStorageBenchmark({
      write: (index) => written.push(index),
      now: () => (clock += 0.5),
    });
    expect(written).toHaveLength(STORAGE_BENCHMARK_WARMUP + STORAGE_BENCHMARK_WRITES);
    expect(result).toStrictEqual({ p50: 0.5, p95: 0.5, max: 0.5, writes: 300 });
  });

  it('writes the entry check-perf-report reads', () => {
    const times = { p50: 0.1, p95: 0.2, max: 0.4, writes: 300 };
    expect(storageBenchmarkEntry(times, 5, '12')).toStrictEqual({
      kind: 'storage-benchmark',
      label: 'storage-write',
      atEpochMs: 5,
      build: '12',
      data: times,
    });
  });
});
