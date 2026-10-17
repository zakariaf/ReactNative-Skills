// src/services/background-run-log/kv-background-error-log-adapter.ts
// The error log of background runs on expo-sqlite/kv-store: a small ring buffer that outlives the run
// and the process. A background run often happens in a process nobody ever looks at (an Android
// headless launch, an iOS background launch), so an in-memory log would take a crash's cause with it.
// The runner records what a job threw here; the debug screen (debug-menu-and-test-hooks) reads it in
// the foreground with entries(), next to lastRun(name, 'background'). Like the run log, it lives
// apart from the app database, so it works before migrations and when the database cannot open.
import Storage from 'expo-sqlite/kv-store';
import * as v from 'valibot';

import { attempt } from '@/core/result';

import type { ClockPort } from '@/services/clock/clock-port';
import type { ErrorLogEntry, ErrorLogPort, ErrorSource } from '@/services/error-log/error-log-port';

/** Namespaced so it never collides with the app's preferences or the run log. */
export const BACKGROUND_ERROR_LOG_KEY = 'background-error-log.entries';

/** Newest entries kept; older ones drop off. Small, because every write rewrites the whole value. */
export const BACKGROUND_ERROR_LOG_LIMIT = 50;

/** Every ErrorSource: tsc fails here when the port's union grows, so a stored source is checked. */
const SOURCES: Readonly<Record<ErrorSource, true>> = {
  render: true,
  'global-handler': true,
  'unhandled-rejection': true,
  startup: true,
  storage: true,
  network: true,
  service: true,
  i18n: true,
};

function isErrorSource(value: unknown): value is ErrorSource {
  return typeof value === 'string' && Object.keys(SOURCES).includes(value);
}

const ENTRY = v.strictObject({
  atMs: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  source: v.custom<ErrorSource>(isErrorSource),
  message: v.string(),
});

export type KvBackgroundErrorLogDeps = {
  readonly clock: Pick<ClockPort, 'nowMs'>;
  /** Takes what kv-store refuses (a full disk, a locked file): this run's memory log. */
  readonly fallback: ErrorLogPort;
  readonly limit?: number;
};

/** Message text that never throws, even for a value whose toString() does. */
function messageOf(error: unknown): string {
  try {
    const message: unknown =
      typeof error === 'object' && error !== null ? Reflect.get(error, 'message') : undefined;
    return typeof message === 'string' ? message : String(error);
  } catch {
    // best-effort: the log must never throw; a value whose text cannot be read still gets an entry.
    return 'unprintable error';
  }
}

/** The stored entries, newest first; an unreadable or malformed value reads as none. */
function parseEntries(text: string | null): readonly ErrorLogEntry[] {
  if (text === null) return [];
  const json = attempt(
    (): unknown => JSON.parse(text),
    () => ({ kind: 'background-error-log-unreadable' }) as const,
  );
  if (!json.ok || !Array.isArray(json.value)) return [];
  return json.value.flatMap((item: unknown) => {
    const parsed = v.safeParse(ENTRY, item);
    return parsed.success ? [parsed.output] : [];
  });
}

/** record() never throws and loses nothing: what kv-store refuses goes to the fallback log. */
export function createKvBackgroundErrorLogAdapter(deps: KvBackgroundErrorLogDeps): ErrorLogPort {
  const limit = deps.limit ?? BACKGROUND_ERROR_LOG_LIMIT;
  return {
    record: (source, error) => {
      const entry: ErrorLogEntry = { atMs: deps.clock.nowMs(), source, message: messageOf(error) };
      try {
        const kept = parseEntries(Storage.getItemSync(BACKGROUND_ERROR_LOG_KEY));
        const next = [entry, ...kept].slice(0, limit);
        Storage.setItemSync(BACKGROUND_ERROR_LOG_KEY, JSON.stringify(next));
      } catch (failure: unknown) {
        deps.fallback.record(source, error);
        deps.fallback.record('storage', failure);
      }
    },
    entries: () => {
      const kept = deps.fallback.entries();
      try {
        const stored = parseEntries(Storage.getItemSync(BACKGROUND_ERROR_LOG_KEY));
        return [...kept, ...stored].sort((first, second) => second.atMs - first.atMs);
      } catch (failure: unknown) {
        const unreadable: ErrorLogEntry = {
          atMs: deps.clock.nowMs(),
          source: 'storage',
          message: `background error log unreadable: ${messageOf(failure)}`,
        };
        return [unreadable, ...kept];
      }
    },
  };
}
