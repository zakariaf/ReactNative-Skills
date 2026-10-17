// src/services/perf/perf-debug-actions.ts
// Test builds only: the debug menu's Performance section, built once by the test-only entry over
// the perf log, so store builds contain none of it. Four actions on the layer's own pieces:
// - "Record frame times": the recorder's shared values (frame runners feed sampleFrame from them);
//   switching it off appends one 'frames' entry;
// - "Run storage benchmark": the app's per-change write, 300 times into a scratch database (never
//   the user's), then one 'storage-benchmark' entry;
// - "Share performance report": the system share sheet with the whole log;
// - the section's summary line: how many entries of each kind the log holds.
import { countByKind, perfReportJson } from '@/core/perf/perf-entry';
import { runStorageBenchmark, storageBenchmarkEntry } from '@/core/perf/write-times';
import { createFrameRecorder, startRecording, stopRecording } from '@/services/perf/frame-recorder';

import type { PerfEntryKind } from '@/core/perf/perf-entry';
import type { WriteTimes } from '@/core/perf/write-times';
import type { Result } from '@/core/result';
import type { FrameRecorder } from '@/services/perf/frame-recorder';
import type { PerfPort, PerfShareFailure } from '@/services/perf/perf-port';
import type { PerfLogPort } from '@/services/perf-log/perf-log-port';

/** The scratch database the benchmark writes to: its own file, deleted or ignored, never the user's. */
export const PERF_BENCH_DB_FILE = 'perf-bench.db';

/** One open scratch database: the app's per-change write against it, and how to close it. */
export type BenchmarkTarget = {
  readonly write: (index: number) => void;
  readonly close: () => void;
};

export type PerfDebugDeps = {
  readonly perfLog: PerfLogPort;
  readonly perf: PerfPort;
  /** Opens PERF_BENCH_DB_FILE with the app's real data layer and seeds its largest realistic data. */
  readonly openBenchmark: (fileName: string) => BenchmarkTarget;
};

export type PerfDebugActions = {
  readonly isRecording: () => boolean;
  /**
   * On: a fresh histogram; off: the recorded frames become one 'frames' entry (none: nothing),
   * labelled with what was measured (e.g. 'tasks/list-scroll'; the menu's own switch: 'debug-menu').
   */
  readonly setRecording: (isOn: boolean, label?: string) => void;
  readonly runStorageBenchmark: () => WriteTimes;
  readonly share: () => Promise<Result<void, PerfShareFailure>>;
  readonly summary: () => Readonly<Record<PerfEntryKind, number>>;
  /** For frame runners: sampleFrame(actions.frames, info.timeSincePreviousFrame). */
  readonly frames: FrameRecorder;
};

/** @public Reached through the test-only entry. */
export function createPerfDebugActions(deps: PerfDebugDeps): PerfDebugActions {
  const { perfLog, perf } = deps;
  const frames = createFrameRecorder();
  const setRecording = (isOn: boolean, label = 'debug-menu'): void => {
    if (isOn) {
      startRecording(frames);
      return;
    }
    const report = stopRecording(frames);
    if (report === null) return;
    perfLog.append({
      kind: 'frames',
      label,
      atEpochMs: perf.epochMs(),
      build: perf.header().buildNumber,
      data: report,
    });
  };
  const runBenchmark = (): WriteTimes => {
    const target = deps.openBenchmark(PERF_BENCH_DB_FILE);
    try {
      const times = runStorageBenchmark({ write: target.write, now: perf.highResMs });
      perfLog.append(storageBenchmarkEntry(times, perf.epochMs(), perf.header().buildNumber));
      return times;
    } finally {
      target.close();
    }
  };
  return {
    isRecording: () => frames.isRecording.get(),
    setRecording,
    runStorageBenchmark: runBenchmark,
    share: () => perf.shareReport(perfReportJson(perf.header(), perfLog.entries())),
    summary: () => countByKind(perfLog.entries()),
    frames,
  };
}
