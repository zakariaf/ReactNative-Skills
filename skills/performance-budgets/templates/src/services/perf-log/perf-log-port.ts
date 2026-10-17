// src/services/perf-log/perf-log-port.ts
// Test builds only: the perf log, a ring buffer of the newest entries (core/perf/perf-entry.ts) kept
// across launches and app updates in its own database file, apart from the user's data and the
// preferences, so a reset, an export, a migration or a preferences clear never touches it (deleting
// the app does). It leaves the device only through the share sheet. Adapter: kv-perf-log-adapter.ts
// (expo-sqlite/kv-store, perf-log.db). Fake: fake-perf-log.ts.
import type { PerfEntry } from '@/core/perf/perf-entry';

/** Appending never throws: a log that cannot be written loses the entry, never the app's work. */
export type PerfLogPort = {
  readonly append: (entry: PerfEntry) => void;
  /** Oldest first; an unreadable store reads as an empty log. */
  readonly entries: () => readonly PerfEntry[];
};
