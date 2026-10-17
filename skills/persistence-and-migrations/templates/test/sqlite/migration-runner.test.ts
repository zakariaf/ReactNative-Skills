// test/sqlite/migration-runner.test.ts: the forward-only runner on real SQL (node:sqlite).
import { migrateDatabase, readUserVersion } from '@/data/migrations/migration-runner';

import { createNodeSqliteSqlDriver } from './node-sqlite-sql-driver';
import { makeTempDatabaseFolder } from './temp-database-folder';

import type { TempDatabaseFolder } from './temp-database-folder';
import type { Migration } from '@/data/migrations/migration-runner';
import type { ClosableSqlDriver } from '@/data/sql-driver';

const CREATE_LISTS: Migration = {
  version: 1,
  name: 'create-lists',
  up: (driver) => {
    driver.exec('CREATE TABLE lists (id INTEGER PRIMARY KEY, name TEXT NOT NULL) STRICT');
  },
};
const CREATE_TASKS: Migration = {
  version: 2,
  name: 'create-tasks',
  up: (driver) => {
    driver.exec(
      'CREATE TABLE tasks (id INTEGER PRIMARY KEY, list_id INTEGER NOT NULL REFERENCES lists (id) ON DELETE CASCADE, title TEXT NOT NULL) STRICT',
    );
  },
};
/** Adds a column the long way (a table rebuild), as a step must when ALTER TABLE cannot. */
const REBUILD_LISTS: Migration = {
  version: 3,
  name: 'rebuild-lists-with-color',
  rebuildsTables: true,
  up: (driver) => {
    driver.exec(`
      CREATE TABLE lists_new (id INTEGER PRIMARY KEY, name TEXT NOT NULL, color TEXT) STRICT;
      INSERT INTO lists_new (id, name) SELECT id, name FROM lists;
      DROP TABLE lists;
      ALTER TABLE lists_new RENAME TO lists;`);
  },
};

function count(driver: ClosableSqlDriver, table: string): unknown {
  return driver.get(`SELECT COUNT(*) AS n FROM ${table}`, [])?.['n'];
}

describe('migrateDatabase', () => {
  let folder: TempDatabaseFolder;
  let driver: ClosableSqlDriver;
  beforeEach(() => {
    folder = makeTempDatabaseFolder();
    driver = createNodeSqliteSqlDriver(folder.file('app.db'));
    driver.exec('PRAGMA foreign_keys = ON');
  });
  afterEach(() => {
    driver.close();
    folder.remove();
  });

  it('applies every pending step in order and stamps each version', () => {
    expect(migrateDatabase(driver, [CREATE_LISTS, CREATE_TASKS])).toStrictEqual({
      kind: 'migrated',
      from: 0,
      to: 2,
    });
    expect(readUserVersion(driver)).toBe(2);
    expect(migrateDatabase(driver, [CREATE_LISTS, CREATE_TASKS])).toStrictEqual({
      kind: 'up-to-date',
      version: 2,
    });
  });

  it('reports a file from a newer app and writes nothing', () => {
    driver.exec('PRAGMA user_version = 7');
    expect(migrateDatabase(driver, [CREATE_LISTS])).toStrictEqual({
      kind: 'newer',
      found: 7,
      latest: 1,
    });
    expect(
      driver.get("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'", []),
    ).toStrictEqual({ n: 0 });
  });

  it('rolls back a failing step and keeps the last completed version', () => {
    const broken: Migration = {
      version: 2,
      name: 'broken-step',
      up: (sql) => {
        sql.exec('CREATE TABLE half_done (id INTEGER PRIMARY KEY) STRICT');
        throw new Error('disk full');
      },
    };
    expect(migrateDatabase(driver, [CREATE_LISTS, broken])).toStrictEqual({
      kind: 'failed',
      from: 0,
      at: 2,
      reason: 'broken-step: disk full',
      error: new Error('disk full'),
    });
    expect(readUserVersion(driver)).toBe(1);
    expect(driver.get("SELECT name FROM sqlite_master WHERE name = 'half_done'", [])).toBeNull();
  });

  it('refuses a list with a gap or a bad name before touching the file', () => {
    const gap = migrateDatabase(driver, [CREATE_LISTS, { ...CREATE_TASKS, version: 3 }]);
    expect(gap).toMatchObject({ kind: 'failed', at: 0 });
    expect(migrateDatabase(driver, [{ ...CREATE_LISTS, name: 'Create Lists' }])).toMatchObject({
      kind: 'failed',
      reason: 'migration list: version 1 is named "Create Lists"',
    });
    expect(readUserVersion(driver)).toBe(0);
  });

  it('keeps cascading child rows when a step rebuilds their parent table', () => {
    migrateDatabase(driver, [CREATE_LISTS, CREATE_TASKS]);
    driver.run('INSERT INTO lists (id, name) VALUES (1, ?)', ['Home']);
    driver.run('INSERT INTO tasks (list_id, title) VALUES (1, ?)', ['Water the plants']);
    expect(migrateDatabase(driver, [CREATE_LISTS, CREATE_TASKS, REBUILD_LISTS])).toMatchObject({
      kind: 'migrated',
      to: 3,
    });
    expect(count(driver, 'tasks')).toBe(1);
    expect(driver.get('PRAGMA foreign_keys', [])).toStrictEqual({ foreign_keys: 1 });
  });

  it('rolls back a rebuild that leaves a broken foreign key', () => {
    migrateDatabase(driver, [CREATE_LISTS, CREATE_TASKS]);
    driver.run('INSERT INTO lists (id, name) VALUES (1, ?)', ['Home']);
    driver.run('INSERT INTO tasks (list_id, title) VALUES (1, ?)', ['Water the plants']);
    const dropsParents: Migration = {
      ...REBUILD_LISTS,
      up: (sql) => {
        sql.exec(
          'CREATE TABLE lists_new (id INTEGER PRIMARY KEY, name TEXT NOT NULL) STRICT; DROP TABLE lists; ALTER TABLE lists_new RENAME TO lists;',
        );
      },
    };
    expect(migrateDatabase(driver, [CREATE_LISTS, CREATE_TASKS, dropsParents])).toMatchObject({
      kind: 'failed',
      at: 3,
    });
    expect([readUserVersion(driver), count(driver, 'lists'), count(driver, 'tasks')]).toStrictEqual(
      [2, 1, 1],
    );
  });
});
