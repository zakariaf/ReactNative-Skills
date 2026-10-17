// src/services/perf-log/kv-perf-log-adapter.ts
// device-only: covered by the debug menu's Performance section in a test build (the summary line counts what this adapter kept across a relaunch), and by fake-perf-log.test.ts for the ring logic.
import { SQLiteStorage } from 'expo-sqlite/kv-store';

import { appendPerfEntry, parsePerfEntries } from '@/core/perf/perf-entry';
import { attempt } from '@/core/result';

import type { PerfEntry } from '@/core/perf/perf-entry';
import type { PerfLogPort } from '@/services/perf-log/perf-log-port';

/**
 * Its own kv-store database file (SQLite/perf-log.db), not the default ExpoSQLiteStorage the app's
 * preferences share: a preferences reset (Storage.clear()) never wipes the evidence.
 */
export const PERF_LOG_DATABASE = 'perf-log.db';
/** The one key inside it. */
export const PERF_LOG_KEY = 'perf.log';

/** The perf log on its own expo-sqlite/kv-store database, never the app's. Test builds create it. */
export function createKvPerfLogAdapter(): PerfLogPort {
  // Opened lazily by the first read or write, never at import time.
  const store = new SQLiteStorage(PERF_LOG_DATABASE);
  const readEntries = (): readonly PerfEntry[] => {
    const read = attempt(
      () => store.getItemSync(PERF_LOG_KEY),
      () => ({ kind: 'perf-log-unreadable' }) as const,
    );
    return read.ok && read.value !== null ? parsePerfEntries(read.value) : [];
  };
  return {
    entries: readEntries,
    append: (entry) => {
      const next = JSON.stringify(appendPerfEntry(readEntries(), entry));
      // A failed write loses this entry only; the share sheet shows what was kept.
      attempt(
        () => {
          store.setItemSync(PERF_LOG_KEY, next);
        },
        () => ({ kind: 'perf-log-not-saved' }) as const,
      );
    },
  };
}
