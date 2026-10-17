// src/data/open-background-data.ts
// device-only: covered by the background run on a device (background-tasks device proof: the run log shows the run)
// Example (Tasks app): the data layer's open path for a background run. It lives in src/data/ because
// only the data layer holds the SqlDriver (persistence-and-migrations); the background environment
// gets repositories and a close function, never the driver. List this file in
// contracts/persistence.json "sqlAllowed": it is open-path infrastructure (it sets the connection
// pragmas), not a repository.
//   - Its own connection (useNewConnection): on iOS and in a live Android process the app's main
//     connection may be open in the same runtime, and closing a shared one would close the app's.
//   - Never migrates: behind the current schema (or ahead of it) it closes again and answers null,
//     and the job defers until the next foreground start migrates. A migration here can be cut
//     mid-step, races the foreground start, and fails where nobody sees it.
//   - Pragmas per connection: foreign_keys and synchronous belong to the connection, not the file.
//   - The SQLite error log over this connection writes to the same error_log table the app's debug
//     screen reads; what it cannot write goes to `fallback` (the background error log on kv-store).
import { APP_DB_FILE, APP_DB_PRAGMAS } from '@/data/app-database';
import { createExpoSqliteSqlDriver } from '@/data/expo-sqlite-sql-driver';
import { readUserVersion } from '@/data/migrations/migration-runner';
import { LATEST_DB_VERSION } from '@/data/migrations/migrations';
import { createSqliteOutboxRepository } from '@/data/outbox/sqlite-outbox-repository';
import { createSqliteErrorLogAdapter } from '@/services/error-log/sqlite-error-log-adapter';

import type { OutboxRepository } from '@/data/outbox/outbox-repository';
import type { ClosableSqlDriver } from '@/data/sql-driver';
import type { ClockPort } from '@/services/clock/clock-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

export type BackgroundData = {
  readonly outbox: OutboxRepository;
  /** The SQLite error log over this connection, falling back to `fallback`. */
  readonly errorLog: ErrorLogPort;
  /** Closes this run's connection; the environment calls it in `dispose`. Never throws. */
  readonly close: () => void;
};

export type OpenBackgroundDataDeps = {
  readonly clock: Pick<ClockPort, 'nowMs'>;
  /** The background error log on kv-store: takes the open's own failure and what SQLite refuses. */
  readonly fallback: ErrorLogPort;
};

function closeQuietly(driver: ClosableSqlDriver, fallback: ErrorLogPort): void {
  try {
    driver.close();
  } catch (thrown: unknown) {
    fallback.record('storage', new Error('background: database not closed', { cause: thrown }));
  }
}

/** The repositories a background run may use, or null when the database is not current. */
export function openBackgroundData(deps: OpenBackgroundDataDeps): BackgroundData | null {
  let driver: ClosableSqlDriver | null = null;
  try {
    driver = createExpoSqliteSqlDriver(APP_DB_FILE, { useNewConnection: true });
    if (readUserVersion(driver) !== LATEST_DB_VERSION) {
      closeQuietly(driver, deps.fallback);
      return null;
    }
    driver.exec(APP_DB_PRAGMAS);
    const open = driver;
    const errorLog = createSqliteErrorLogAdapter({
      driver: open,
      clock: deps.clock,
      fallback: deps.fallback,
    });
    return {
      outbox: createSqliteOutboxRepository({ driver: open, clock: deps.clock, errorLog }),
      errorLog,
      close: () => {
        closeQuietly(open, deps.fallback);
      },
    };
  } catch (thrown: unknown) {
    deps.fallback.record(
      'storage',
      new Error('background: database not opened', { cause: thrown }),
    );
    if (driver !== null) closeQuietly(driver, deps.fallback);
    return null;
  }
}
