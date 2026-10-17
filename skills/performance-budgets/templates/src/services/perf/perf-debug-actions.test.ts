// src/services/perf/perf-debug-actions.test.ts
import { STORAGE_BENCHMARK_WARMUP, STORAGE_BENCHMARK_WRITES } from '@/core/perf/write-times';
import { createFakePerfLog } from '@/services/perf-log/fake-perf-log';

import { createFakePerf } from './fake-perf';
import { sampleFrame } from './frame-recorder';
import { PERF_BENCH_DB_FILE, createPerfDebugActions } from './perf-debug-actions';

import type { BenchmarkTarget } from './perf-debug-actions';
function setup() {
  const perfLog = createFakePerfLog();
  const perf = createFakePerf({ epochMs: 5_000, highResStepMs: 0.25 });
  const opened: string[] = [];
  const target = { writes: 0, isClosed: false };
  const openBenchmark = (fileName: string): BenchmarkTarget => {
    opened.push(fileName);
    return {
      write: () => {
        target.writes += 1;
      },
      close: () => {
        target.isClosed = true;
      },
    };
  };
  const actions = createPerfDebugActions({ perfLog, perf, openBenchmark });
  return { actions, perfLog, perf, opened, target };
}

describe('createPerfDebugActions (test builds)', () => {
  it('records frame times while switched on and logs one frames entry when switched off', () => {
    const { actions, perfLog } = setup();
    actions.setRecording(true);
    expect(actions.isRecording()).toBe(true);
    sampleFrame(actions.frames, 8.3);
    sampleFrame(actions.frames, 8.4);
    actions.setRecording(false);
    expect(actions.isRecording()).toBe(false);
    expect(perfLog.items()).toStrictEqual([
      expect.objectContaining({
        kind: 'frames',
        label: 'debug-menu',
        atEpochMs: 5_000,
        build: '1',
      }),
    ]);
    expect(perfLog.items()[0]?.data['frames']).toBe(2);
  });

  it('labels the frames entry with what was measured when the caller names it', () => {
    const { actions, perfLog } = setup();
    actions.setRecording(true);
    sampleFrame(actions.frames, 8.3);
    actions.setRecording(false, 'tasks/list-scroll');
    expect(perfLog.items()[0]?.label).toBe('tasks/list-scroll');
  });

  it('logs nothing when no frame ran between on and off', () => {
    const { actions, perfLog } = setup();
    actions.setRecording(true);
    actions.setRecording(false);
    expect(perfLog.items()).toStrictEqual([]);
  });

  it('runs the benchmark on the scratch file only, closes it and logs the numbers', () => {
    const { actions, perfLog, opened, target } = setup();
    const times = actions.runStorageBenchmark();
    expect([opened, target.writes, target.isClosed]).toStrictEqual([
      [PERF_BENCH_DB_FILE],
      STORAGE_BENCHMARK_WARMUP + STORAGE_BENCHMARK_WRITES,
      true,
    ]);
    expect(times).toStrictEqual({ p50: 0.25, p95: 0.25, max: 0.25, writes: 300 });
    expect(perfLog.items()).toStrictEqual([
      {
        kind: 'storage-benchmark',
        label: 'storage-write',
        atEpochMs: 5_000,
        build: '1',
        data: times,
      },
    ]);
  });

  it('shares the whole log with the build header and counts the entries per kind', async () => {
    const { actions, perfLog, perf } = setup();
    perfLog.append({
      kind: 'cold-start',
      label: 'tasks',
      atEpochMs: 1,
      build: '1',
      data: { totalMs: 900 },
    });
    await expect(actions.share()).resolves.toStrictEqual({ ok: true, value: undefined });
    expect(JSON.parse(perf.shared[0] ?? '{}')).toMatchObject({ appId: 'com.example.tasks' });
    expect(actions.summary()).toStrictEqual({
      frames: 0,
      'cold-start': 1,
      'storage-benchmark': 0,
      trace: 0,
    });
  });
});
