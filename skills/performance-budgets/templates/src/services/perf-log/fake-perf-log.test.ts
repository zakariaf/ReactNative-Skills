// src/services/perf-log/fake-perf-log.test.ts
import { MAX_EVIDENCE_ENTRIES } from '@/core/perf/perf-entry';

import { createFakePerfLog } from './fake-perf-log';

import type { PerfEntry } from '@/core/perf/perf-entry';

function entry(index: number): PerfEntry {
  return {
    kind: 'cold-start',
    label: 'tasks',
    atEpochMs: index,
    build: '1',
    data: { totalMs: 800 + index },
  };
}

describe('createFakePerfLog', () => {
  it('starts with what it was given and appends in order', () => {
    const log = createFakePerfLog([entry(1)]);
    log.append(entry(2));
    expect(log.entries()).toStrictEqual([entry(1), entry(2)]);
  });

  it('keeps the ring buffer of the real adapter', () => {
    const log = createFakePerfLog();
    for (let index = 1; index <= MAX_EVIDENCE_ENTRIES + 1; index += 1) log.append(entry(index));
    expect([log.items().length, log.items()[0]?.atEpochMs]).toStrictEqual([
      MAX_EVIDENCE_ENTRIES,
      2,
    ]);
  });
});
