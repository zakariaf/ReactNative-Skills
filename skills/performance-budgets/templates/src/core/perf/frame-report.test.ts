// src/core/perf/frame-report.test.ts
import { createFrameHistogram, recordFrame } from './frame-histogram';
import { refreshRateOf, summarizeFrames } from './frame-report';

import type { FrameHistogram } from './frame-histogram';

function record(intervalsMs: readonly number[]): FrameHistogram {
  return intervalsMs.reduce(recordFrame, createFrameHistogram());
}

function steady(hz: number, count: number): number[] {
  return Array.from({ length: count }, () => 1000 / hz);
}

describe('summarizeFrames', () => {
  it('returns null when no frame was recorded', () => {
    expect(summarizeFrames(createFrameHistogram())).toBeNull();
  });

  it('reports a clean 120 Hz second as hitch-free', () => {
    const report = summarizeFrames(record(steady(120, 120)));
    expect(report).toMatchObject({ refreshHz: 120, p95UpToMs: 9, hitchMsPerS: 0 });
  });

  it('reports a clean 90 Hz second as hitch-free, not as late 120 Hz frames', () => {
    const report = summarizeFrames(record(steady(90, 90)));
    expect(report).toMatchObject({ refreshHz: 90, p95UpToMs: 17, hitchMsPerS: 0 });
  });

  it('charges one 50 ms stall as 41.7 ms of hitch at 120 Hz', () => {
    const report = summarizeFrames(record([...steady(120, 114), 50]));
    expect(report?.maxMs).toBe(50);
    expect(report?.hitchMsPerS).toBeCloseTo(41.7, 1);
  });

  it('puts a p95 in the slowest bucket at Infinity, which JSON writes as null', () => {
    const report = summarizeFrames(record([16.7, 120, 140, 160]));
    expect(report?.p95UpToMs).toBe(Number.POSITIVE_INFINITY);
    expect(JSON.parse(JSON.stringify(report))).toMatchObject({ p95UpToMs: null, refreshHz: 60 });
  });

  it('ignores the first-frame interval (recorded as 0)', () => {
    expect(record([0, 16.7]).frames).toBe(1);
  });
});

describe('refreshRateOf', () => {
  it('splits the rates midway between their frame budgets', () => {
    expect([8.3, 9.6, 11.1, 13.8, 16.7].map(refreshRateOf)).toStrictEqual([120, 120, 90, 90, 60]);
  });
});
