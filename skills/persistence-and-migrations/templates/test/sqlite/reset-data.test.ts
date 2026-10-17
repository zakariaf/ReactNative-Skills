// test/sqlite/reset-data.test.ts: a reset clears the user's tables and never the protected ones.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { migrateDatabase } from '@/data/migrations/migration-runner';
import { MIGRATIONS } from '@/data/migrations/migrations';
import { createResetAllData, resetAllData } from '@/data/reset-data';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { createNodeSqliteSqlDriver } from './node-sqlite-sql-driver';

const FIXTURE = join(__dirname, '..', '..', 'src', 'data', 'migrations', 'fixtures', 'db-v1.sql');

type NodeDriver = ReturnType<typeof createNodeSqliteSqlDriver>;

function countOf(driver: NodeDriver, table: string): unknown {
  return driver.get(`SELECT COUNT(*) AS n FROM ${table}`, [])?.['n'];
}

/** The frozen v1 fixture, migrated to the latest version. */
function fixtureDatabase(): NodeDriver {
  const driver = createNodeSqliteSqlDriver(':memory:');
  driver.exec(readFileSync(FIXTURE, 'utf8'));
  driver.exec('PRAGMA foreign_keys = ON');
  migrateDatabase(driver, MIGRATIONS);
  return driver;
}

describe('resetAllData', () => {
  it('clears lists and tasks and keeps entitlements and the error log', () => {
    const driver = fixtureDatabase();
    const kept = driver.all('SELECT * FROM entitlements', []);
    resetAllData(driver);
    expect(['tasks', 'lists'].map((table) => countOf(driver, table))).toStrictEqual([0, 0]);
    expect(driver.all('SELECT * FROM entitlements', [])).toStrictEqual(kept);
    expect(countOf(driver, 'error_log')).toBe(2);
    driver.close();
  });
});

describe('createResetAllData (AppData.resetAllData)', () => {
  it('returns ok once the tables are cleared', () => {
    const driver = fixtureDatabase();
    const errorLog = createFakeErrorLog();
    expect(createResetAllData(driver, errorLog)()).toStrictEqual({ ok: true, value: undefined });
    expect(countOf(driver, 'tasks')).toBe(0);
    expect(errorLog.recorded).toHaveLength(0);
    driver.close();
  });

  it('returns a StorageFailure, logs the raw error and rolls the whole reset back', () => {
    const driver = fixtureDatabase();
    const errorLog = createFakeErrorLog();
    const before = ['tasks', 'lists'].map((table) => countOf(driver, table));
    // tasks are deleted first; the second statement fails, so the first must not survive.
    driver.exec(
      "CREATE TRIGGER keep_lists BEFORE DELETE ON lists BEGIN SELECT RAISE(ABORT, 'kept'); END",
    );
    const reset = createResetAllData(driver, errorLog)();
    expect(reset).toStrictEqual({ ok: false, error: { kind: 'constraint', detail: 'other' } });
    expect(['tasks', 'lists'].map((table) => countOf(driver, table))).toStrictEqual(before);
    expect(errorLog.recorded.map(({ source }) => source)).toStrictEqual(['storage']);
    driver.close();
  });
});
