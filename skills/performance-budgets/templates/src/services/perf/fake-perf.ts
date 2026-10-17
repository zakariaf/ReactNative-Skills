// src/services/perf/fake-perf.ts
import { err, ok } from '@/core/result';

import type { PerfReportHeader } from '@/core/perf/perf-entry';
import type { PerfPort } from '@/services/perf/perf-port';

export const FAKE_PERF_HEADER: PerfReportHeader = {
  appId: 'com.example.tasks',
  appVersion: '1.0.0',
  buildNumber: '1',
  platform: 'ios',
  osVersion: '26.5',
  deviceModel: 'iPhone17,1',
};

export type FakePerfOptions = {
  readonly epochMs?: number;
  readonly processStartEpochMs?: number | null;
  readonly isPrewarmed?: boolean;
  /** How far highResMs() moves on every read (a write between two reads measures this much). */
  readonly highResStepMs?: number;
  readonly isShareFailing?: boolean;
};

/** A PerfPort whose clocks move only when a test says so, and whose share sheet records the JSON. */
export type FakePerf = PerfPort & {
  readonly advance: (ms: number) => void;
  readonly shared: readonly string[];
};

export function createFakePerf(options: FakePerfOptions = {}): FakePerf {
  let epochMs = options.epochMs ?? 1_790_000_000_000;
  let highResMs = 0;
  const step = options.highResStepMs ?? 0;
  const shared: string[] = [];
  return {
    epochMs: () => epochMs,
    highResMs: () => (highResMs += step),
    processStartEpochMs: () => options.processStartEpochMs ?? null,
    wasPrewarmed: () => options.isPrewarmed ?? false,
    header: () => FAKE_PERF_HEADER,
    shareReport: (json) => {
      if (options.isShareFailing === true) {
        return Promise.resolve(err({ kind: 'perf-share-failed' as const }));
      }
      shared.push(json);
      return Promise.resolve(ok(undefined));
    },
    advance: (ms) => {
      epochMs += ms;
      highResMs += ms;
    },
    shared,
  };
}
