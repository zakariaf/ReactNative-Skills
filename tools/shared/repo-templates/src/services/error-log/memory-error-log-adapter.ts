// src/services/error-log/memory-error-log-adapter.ts
// The session's error log: the newest entries in memory, from the first line of startup (before
// any database is open). A persistent adapter from the storage layer can replace it in the
// composition root; the port stays the same.
import type { ClockPort } from '@/services/clock/clock-port';
import type { ErrorLogEntry, ErrorLogPort, ErrorSource } from '@/services/error-log/error-log-port';

/** How many entries the log keeps; older ones drop off. */
export const MEMORY_ERROR_LOG_LIMIT = 200;

export type MemoryErrorLogDeps = {
  readonly clock: Pick<ClockPort, 'nowMs'>;
  readonly limit?: number;
};

/** Message text that never throws, even for a value whose toString() does. */
function messageOf(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    // best-effort: the log must never throw; a value whose text cannot be read still gets an entry.
    return 'unprintable error';
  }
}

/** Creates the in-memory ErrorLogPort. Called once, by the composition root. */
export function createMemoryErrorLogAdapter(deps: MemoryErrorLogDeps): ErrorLogPort {
  const limit = deps.limit ?? MEMORY_ERROR_LOG_LIMIT;
  const newestFirst: ErrorLogEntry[] = [];
  const record = (source: ErrorSource, error: unknown): void => {
    newestFirst.unshift({
      atMs: deps.clock.nowMs(),
      source,
      message: messageOf(error),
    });
    newestFirst.splice(limit);
  };
  return { record, entries: () => [...newestFirst] };
}
