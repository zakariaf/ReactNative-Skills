// src/core/perf/perf-entry.test.ts
import {
  MAX_EVIDENCE_ENTRIES,
  MAX_TRACE_ENTRIES,
  appendPerfEntry,
  countByKind,
  parsePerfEntries,
  perfReportJson,
} from './perf-entry';

import type { PerfEntry } from './perf-entry';

function frames(index: number): PerfEntry {
  return {
    kind: 'frames',
    label: `run-${String(index)}`,
    atEpochMs: index,
    build: '7',
    data: { p95: index },
  };
}

function trace(index: number): PerfEntry {
  return { kind: 'trace', label: 'frame', atEpochMs: index, build: '7', data: { seq: index } };
}

function appendAll(entries: readonly PerfEntry[]): readonly PerfEntry[] {
  return entries.reduce<readonly PerfEntry[]>(appendPerfEntry, []);
}

describe('appendPerfEntry', () => {
  it('keeps entries in the order they were appended', () => {
    expect(appendAll([frames(1), frames(2)])).toStrictEqual([frames(1), frames(2)]);
  });

  it('keeps only the newest evidence entries', () => {
    const kept = appendAll(
      Array.from({ length: MAX_EVIDENCE_ENTRIES + 5 }, (_, i) => frames(i + 1)),
    );
    expect([kept.length, kept[0]?.label, kept.at(-1)?.label]).toStrictEqual([
      MAX_EVIDENCE_ENTRIES,
      'run-6',
      `run-${String(MAX_EVIDENCE_ENTRIES + 5)}`,
    ]);
  });

  it('keeps the newest traces beside the evidence, never instead of it', () => {
    const traces = Array.from({ length: MAX_TRACE_ENTRIES + 5 }, (_, i) => trace(i + 1));
    const kept = appendAll([frames(1), ...traces]);
    expect(kept.filter((entry) => entry.kind === 'trace')).toHaveLength(MAX_TRACE_ENTRIES);
    expect(kept[0]).toStrictEqual(frames(1));
    expect(kept[1]?.atEpochMs).toBe(6);
  });
});

describe('parsePerfEntries', () => {
  it('reads a stored list and drops anything that is not an entry', () => {
    const payload = JSON.stringify([frames(1), { kind: 'other', label: 'x' }, trace(2), 7]);
    expect(parsePerfEntries(payload)).toStrictEqual([frames(1), trace(2)]);
  });

  it('reads an entry written before entries were stamped with build null', () => {
    const unstamped = { kind: 'frames', label: 'run-1', atEpochMs: 1, data: { p95: 1 } };
    expect(parsePerfEntries(JSON.stringify([unstamped]))).toStrictEqual([
      { ...unstamped, build: null },
    ]);
  });

  it('drops an entry whose build is not a string', () => {
    expect(parsePerfEntries(JSON.stringify([{ ...frames(1), build: 7 }]))).toStrictEqual([]);
  });

  it('reads a damaged or foreign payload as an empty log', () => {
    expect([parsePerfEntries('{'), parsePerfEntries('{"entries":[]}')]).toStrictEqual([[], []]);
  });
});

describe('the shared report', () => {
  it('counts the entries of each kind', () => {
    expect(countByKind([frames(1), trace(2), frames(3)])).toStrictEqual({
      frames: 2,
      'cold-start': 0,
      'storage-benchmark': 0,
      trace: 1,
    });
  });

  it('writes the header and every entry as one JSON object', () => {
    const header = {
      appId: 'com.example.tasks',
      appVersion: '1.0.0',
      buildNumber: '7',
      platform: 'android',
      osVersion: '36',
      deviceModel: 'Google Pixel 9',
    };
    expect(JSON.parse(perfReportJson(header, [frames(1)]))).toStrictEqual({
      ...header,
      entries: [frames(1)],
    });
  });
});
