// test/sqlite/v0002-add-list-sort-order.test.ts: what version 2 promises old installs, value by value, on the frozen v1 database.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { migrateDatabase } from '@/data/migrations/migration-runner';
import { MIGRATIONS } from '@/data/migrations/migrations';

import { rowsOf } from './database-content';
import { createNodeSqliteSqlDriver } from './node-sqlite-sql-driver';

import type { ClosableSqlDriver } from '@/data/sql-driver';

const V1 = join(__dirname, '..', '..', 'src', 'data', 'migrations', 'fixtures', 'db-v1.sql');

/** The frozen v1 database as a device holds it (foreign keys on), before the upgrade. */
function v1Database(): ClosableSqlDriver {
  const driver = createNodeSqliteSqlDriver(':memory:');
  driver.exec(readFileSync(V1, 'utf8'));
  driver.exec('PRAGMA foreign_keys = ON');
  return driver;
}

describe('v0002 add-list-sort-order', () => {
  it('orders the v1 lists by creation and changes no other value', () => {
    const driver = v1Database();
    const lists = rowsOf(driver, 'lists');
    const tasks = rowsOf(driver, 'tasks');
    expect(migrateDatabase(driver, MIGRATIONS)).toStrictEqual({ kind: 'migrated', from: 1, to: 2 });
    expect(rowsOf(driver, 'lists')).toStrictEqual(
      lists.map((list, index) => ({ ...list, sort_order: index })),
    );
    expect(rowsOf(driver, 'tasks')).toStrictEqual(tasks);
    driver.close();
  });

  it('keeps the hostile titles byte for byte (apostrophe, Arabic, emoji)', () => {
    const driver = v1Database();
    migrateDatabase(driver, MIGRATIONS);
    expect(
      driver.all('SELECT title FROM tasks WHERE id IN (2, 3, 4) ORDER BY id', []),
    ).toStrictEqual([
      { title: "Call the plumber about the kitchen's tap" },
      { title: 'شراء الحليب' },
      { title: 'Send the report 📊' },
    ]);
    driver.close();
  });

  it('refuses a negative order', () => {
    const driver = v1Database();
    migrateDatabase(driver, MIGRATIONS);
    expect(() => driver.run('UPDATE lists SET sort_order = ? WHERE id = ?', [-1, 1])).toThrow(
      'CHECK constraint failed',
    );
    driver.close();
  });
});
