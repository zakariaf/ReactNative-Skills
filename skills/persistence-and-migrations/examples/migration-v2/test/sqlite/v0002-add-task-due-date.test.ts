// test/sqlite/v0002-add-task-due-date.test.ts: what version 2 promises old installs, on the frozen v1 database.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { migrateDatabase } from '@/data/migrations/migration-runner';
import { MIGRATIONS } from '@/data/migrations/migrations';

import { createNodeSqliteSqlDriver } from './node-sqlite-sql-driver';

const V1 = join(__dirname, '..', '..', 'src', 'data', 'migrations', 'fixtures', 'db-v1.sql');

function upgradedV1(): ReturnType<typeof createNodeSqliteSqlDriver> {
  const driver = createNodeSqliteSqlDriver(':memory:');
  driver.exec(readFileSync(V1, 'utf8'));
  driver.exec('PRAGMA foreign_keys = ON');
  expect(migrateDatabase(driver, MIGRATIONS)).toStrictEqual({ kind: 'migrated', from: 1, to: 2 });
  return driver;
}

describe('v0002 add-task-due-date', () => {
  it('keeps every v1 task unchanged and gives it no due date', () => {
    const driver = upgradedV1();
    expect(
      driver.all('SELECT id, title, is_done, due_on FROM tasks ORDER BY id', []),
    ).toStrictEqual([
      { id: 1, title: 'Water the plants', is_done: 1, due_on: null },
      { id: 2, title: "Call the plumber about the kitchen's tap", is_done: 0, due_on: null },
      { id: 3, title: 'شراء الحليب', is_done: 0, due_on: null },
      { id: 4, title: 'Send the report 📊', is_done: 0, due_on: null },
    ]);
    driver.close();
  });

  it('accepts a date key and refuses anything else', () => {
    const driver = upgradedV1();
    driver.run('UPDATE tasks SET due_on = ? WHERE id = ?', ['2026-10-05', 1]);
    expect(() => driver.run('UPDATE tasks SET due_on = ? WHERE id = ?', ['next week', 2])).toThrow(
      'CHECK constraint failed',
    );
    driver.close();
  });
});
