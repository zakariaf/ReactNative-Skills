// src/test-only-entry.ts
// The test-only entry (debug-menu-and-test-hooks): the perf log and the Performance actions.
import { createPerfDebugActions } from '@/services/perf/perf-debug-actions';
import { createKvPerfLogAdapter } from '@/services/perf-log/kv-perf-log-adapter';

import type { PerfPort } from '@/services/perf/perf-port';
import type { BenchmarkTarget } from '@/services/perf/perf-debug-actions';

export function createTestOnlyPerf(perf: PerfPort, openBenchmark: (file: string) => BenchmarkTarget) {
  const perfLog = createKvPerfLogAdapter();
  return { perfLog, actions: createPerfDebugActions({ perfLog, perf, openBenchmark }) };
}
