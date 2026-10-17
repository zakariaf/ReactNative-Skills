// src/services/error-log/sqlite-error-log-adapter.ts: the error log as a ring buffer in the app database (newest 200 rows).
import * as v from 'valibot';

import type { SqlDriver } from '@/data/sql-driver';
import type { ClockPort } from '@/services/clock/clock-port';
import type { ErrorLogEntry, ErrorLogPort, ErrorSource } from '@/services/error-log/error-log-port';

const KEEP_ROWS = 200;
const INSERT_SQL = 'INSERT INTO error_log (at_ms, area, message, details) VALUES (?, ?, ?, NULL)';
const TRIM_SQL = 'DELETE FROM error_log WHERE id <= (SELECT MAX(id) FROM error_log) - ?';
const LIST_SQL = 'SELECT at_ms, area, message FROM error_log ORDER BY id DESC LIMIT ?';

/** Every ErrorSource: tsc fails here when the port's union grows, so a row's area is checked on read. */
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

/** A row an older or buggy build wrote with an unknown area is skipped, not shown as a lie. */
const ERROR_LOG_ROW = v.strictObject({
  at_ms: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  area: v.custom<ErrorSource>(isErrorSource),
  message: v.string(),
});

/** The message of an Error from any realm (a node:sqlite error inside Jest fails instanceof Error). */
function messageOf(error: unknown): string {
  try {
    const message: unknown =
      typeof error === 'object' && error !== null ? Reflect.get(error, 'message') : undefined;
    return typeof message === 'string' ? message : String(error);
  } catch {
    // best-effort: a value whose toString() throws still gets a line in the log.
    return 'unprintable error';
  }
}

export type SqliteErrorLogDeps = {
  /** The app database; its first migration creates error_log. */
  readonly driver: SqlDriver;
  readonly clock: Pick<ClockPort, 'nowMs'>;
  /**
   * Takes what the table cannot: before the table exists, inside another transaction (the driver
   * refuses to nest), on a full disk. The session's memory log is the natural one.
   */
  readonly fallback: ErrorLogPort;
};

function readRows(driver: SqlDriver): readonly ErrorLogEntry[] {
  return driver.all(LIST_SQL, [KEEP_ROWS]).flatMap((row) => {
    const parsed = v.safeParse(ERROR_LOG_ROW, row);
    if (!parsed.success) return [];
    const { at_ms: atMs, area: source, message } = parsed.output;
    return [{ atMs, source, message }];
  });
}

/** record() never throws and loses nothing: what the table refuses goes to the fallback log. */
export function createSqliteErrorLogAdapter(deps: SqliteErrorLogDeps): ErrorLogPort {
  const { driver, clock, fallback } = deps;
  return {
    record: (source, error) => {
      try {
        driver.transaction(() => {
          driver.run(INSERT_SQL, [clock.nowMs(), source, messageOf(error)]);
          driver.run(TRIM_SQL, [KEEP_ROWS]);
        });
      } catch (failure: unknown) {
        fallback.record(source, error);
        fallback.record('storage', failure);
      }
    },
    entries: () => {
      const kept = fallback.entries();
      try {
        return [...kept, ...readRows(driver)].sort((first, second) => second.atMs - first.atMs);
      } catch (failure: unknown) {
        const unreadable: ErrorLogEntry = {
          atMs: clock.nowMs(),
          source: 'storage',
          message: `error log unreadable: ${messageOf(failure)}`,
        };
        return [unreadable, ...kept];
      }
    },
  };
}
