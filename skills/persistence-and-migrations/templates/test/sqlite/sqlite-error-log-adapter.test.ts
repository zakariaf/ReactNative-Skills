// test/sqlite/sqlite-error-log-adapter.test.ts: the error log ring buffer on real SQL, and its fallback.
import { migrateDatabase } from '@/data/migrations/migration-runner';
import { MIGRATIONS } from '@/data/migrations/migrations';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createSqliteErrorLogAdapter } from '@/services/error-log/sqlite-error-log-adapter';

import { createNodeSqliteSqlDriver } from './node-sqlite-sql-driver';

import type { ClosableSqlDriver } from '@/data/sql-driver';

function migrated(): ClosableSqlDriver {
  const driver = createNodeSqliteSqlDriver(':memory:');
  migrateDatabase(driver, MIGRATIONS);
  return driver;
}

describe('createSqliteErrorLogAdapter', () => {
  it('lists recorded errors newest first with their source and time', () => {
    const driver = migrated();
    let now = 100;
    const log = createSqliteErrorLogAdapter({
      driver,
      clock: { nowMs: () => now },
      fallback: createFakeErrorLog(),
    });
    log.record('storage', new Error('disk full'));
    now = 200;
    log.record('network', 'timed out');
    expect(log.entries()).toStrictEqual([
      { atMs: 200, source: 'network', message: 'timed out' },
      { atMs: 100, source: 'storage', message: 'disk full' },
    ]);
    driver.close();
  });

  it('keeps only the newest 200 rows', () => {
    const driver = migrated();
    const log = createSqliteErrorLogAdapter({
      driver,
      clock: { nowMs: () => 1 },
      fallback: createFakeErrorLog(),
    });
    for (let index = 0; index < 205; index += 1) log.record('startup', `error ${String(index)}`);
    expect(log.entries()).toHaveLength(200);
    expect(log.entries()[0]?.message).toBe('error 204');
    driver.close();
  });

  it('hands an error to the fallback before the table exists, and never throws', () => {
    const driver = createNodeSqliteSqlDriver(':memory:');
    const fallback = createFakeErrorLog();
    const log = createSqliteErrorLogAdapter({ driver, clock: { nowMs: () => 1 }, fallback });
    expect(() => {
      log.record('startup', new Error('early'));
    }).not.toThrow();
    expect(fallback.recorded.map((entry) => entry.source)).toStrictEqual(['startup', 'storage']);
    expect(fallback.recorded[1]?.error).toHaveProperty('message', 'no such table: error_log');
    expect(log.entries()[0]).toStrictEqual({
      atMs: 1,
      source: 'storage',
      message: 'error log unreadable: no such table: error_log',
    });
    driver.close();
  });

  it('keeps an error recorded inside a repository transaction without touching that transaction', () => {
    const driver = migrated();
    const fallback = createFakeErrorLog();
    const log = createSqliteErrorLogAdapter({ driver, clock: { nowMs: () => 1 }, fallback });
    driver.transaction(() => {
      driver.run('INSERT INTO lists (name, created_at_ms) VALUES (?, ?)', ['Home', 1]);
      log.record('storage', new Error('unreadable tasks row: is_done'));
      driver.run('INSERT INTO lists (name, created_at_ms) VALUES (?, ?)', ['Work', 1]);
    });
    expect(driver.get('SELECT COUNT(*) AS n FROM lists', [])).toStrictEqual({ n: 2 });
    expect(fallback.entries()[1]?.message).toBe('unreadable tasks row: is_done');
    driver.close();
  });

  it('skips a row whose area is not a known source', () => {
    const driver = migrated();
    driver.run('INSERT INTO error_log (at_ms, area, message) VALUES (?, ?, ?)', [5, 'boot', 'old']);
    driver.run('INSERT INTO error_log (at_ms, area, message) VALUES (?, ?, ?)', [
      6,
      'storage',
      'new',
    ]);
    const log = createSqliteErrorLogAdapter({
      driver,
      clock: { nowMs: () => 9 },
      fallback: createFakeErrorLog(),
    });
    expect(log.entries()).toStrictEqual([{ atMs: 6, source: 'storage', message: 'new' }]);
    driver.close();
  });
});
