// src/services/perf-log/fake-perf-log.ts
import { appendPerfEntry } from '@/core/perf/perf-entry';

import type { PerfEntry } from '@/core/perf/perf-entry';
import type { PerfLogPort } from '@/services/perf-log/perf-log-port';

/** An in-memory perf log with the adapter's ring buffer; `items` shows what a test appended. */
export type FakePerfLog = PerfLogPort & { readonly items: () => readonly PerfEntry[] };

export function createFakePerfLog(initial: readonly PerfEntry[] = []): FakePerfLog {
  let entries = initial;
  return {
    append: (entry) => {
      entries = appendPerfEntry(entries, entry);
    },
    entries: () => entries,
    items: () => entries,
  };
}
