// test/sqlite/to-storage-failure.test.ts: the mapper on the errors node:sqlite really throws, and on the device message forms.
import { writeFileSync } from 'node:fs';

import { toStorageFailure } from '@/data/to-storage-failure';

import { createNodeSqliteSqlDriver } from './node-sqlite-sql-driver';
import { makeTempDatabaseFolder } from './temp-database-folder';

import type { TempDatabaseFolder } from './temp-database-folder';
import type { ClosableSqlDriver } from '@/data/sql-driver';

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error: unknown) {
    return error;
  }
  throw new Error('expected the statement to throw');
}

function messageOf(thrown: unknown): string {
  const message: unknown =
    typeof thrown === 'object' && thrown !== null ? Reflect.get(thrown, 'message') : undefined;
  return typeof message === 'string' ? message : '';
}

/** How expo-modules-core wraps a native error on each platform (only the tail is parsed). */
const IOS_PREFIX = "Calling the 'runSync' function has failed\n→ Caused by: ";
const ANDROID_PREFIX =
  "Call to function 'NativeStatement.runSync' has been rejected.\n→ Caused by: ";

describe('toStorageFailure', () => {
  let folder: TempDatabaseFolder;
  let driver: ClosableSqlDriver;
  beforeEach(() => {
    folder = makeTempDatabaseFolder();
    driver = createNodeSqliteSqlDriver(':memory:');
    driver.exec(`
      CREATE TABLE lists (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE CHECK (length(name) <= 5)) STRICT;
      CREATE TABLE tasks (id INTEGER PRIMARY KEY, list_id INTEGER NOT NULL REFERENCES lists (id)) STRICT;
      PRAGMA foreign_keys = ON;
      INSERT INTO lists (id, name) VALUES (1, 'Home');`);
  });
  afterEach(() => {
    driver.close();
    folder.remove();
  });

  it('names each constraint a statement broke', () => {
    const insertList = 'INSERT INTO lists (id, name) VALUES (?, ?)';
    const cases = [
      [insertList, [1, 'Work'], 'unique'],
      [insertList, [2, 'Home'], 'unique'],
      [insertList, [2, null], 'not-null'],
      [insertList, [2, 'Too long'], 'check'],
      ['INSERT INTO tasks (list_id) VALUES (?)', [9], 'foreign-key'],
    ] as const;
    for (const [sql, params, detail] of cases) {
      const thrown = thrownBy(() => driver.run(sql, params));
      expect(toStorageFailure(thrown)).toStrictEqual({ kind: 'constraint', detail });
    }
  });

  it('maps a full database (max_page_count reached)', () => {
    driver.exec('CREATE TABLE blobs (data TEXT) STRICT');
    const pages = Number(driver.get('PRAGMA page_count', [])?.['page_count']);
    driver.exec(`PRAGMA max_page_count = ${String(pages)}`);
    const thrown = thrownBy(() => driver.run('INSERT INTO blobs VALUES (?)', ['x'.repeat(65_536)]));
    expect(toStorageFailure(thrown)).toStrictEqual({ kind: 'full' });
  });

  it('maps a database another connection holds locked to busy', () => {
    const holder = createNodeSqliteSqlDriver(folder.file('locked.db'));
    holder.exec('CREATE TABLE notes (id INTEGER) STRICT; BEGIN EXCLUSIVE;');
    const writer = createNodeSqliteSqlDriver(folder.file('locked.db'));
    writer.exec('PRAGMA busy_timeout = 0');
    const thrown = thrownBy(() => writer.run('INSERT INTO notes VALUES (1)', []));
    expect(toStorageFailure(thrown)).toStrictEqual({ kind: 'busy' });
    holder.exec('ROLLBACK');
    writer.close();
    holder.close();
  });

  it('maps a file that is not a database to corrupt', () => {
    writeFileSync(folder.file('junk.db'), 'x'.repeat(4096));
    const junk = createNodeSqliteSqlDriver(folder.file('junk.db'));
    expect(
      toStorageFailure(thrownBy(() => junk.all('SELECT * FROM sqlite_master', []))),
    ).toStrictEqual({
      kind: 'corrupt',
    });
    junk.close();
  });

  it('reads the decimal code of the iOS form and the one-character code of the Android form', () => {
    const real = messageOf(
      thrownBy(() => driver.run('INSERT INTO lists VALUES (?, ?)', [3, 'Home'])),
    );
    expect(real).toBe('UNIQUE constraint failed: lists.name');
    const ios = new Error(`${IOS_PREFIX}Error code 19: ${real}`);
    const android = new Error(`${ANDROID_PREFIX}Error code ${String.fromCharCode(19)}: ${real}`);
    expect([toStorageFailure(ios), toStorageFailure(android)]).toStrictEqual([
      { kind: 'constraint', detail: 'unique' },
      { kind: 'constraint', detail: 'unique' },
    ]);
    expect(toStorageFailure(new Error(`Error code ${String.fromCharCode(13)}: x`))).toStrictEqual({
      kind: 'full',
    });
  });

  it('falls back to the SQLite message text, and never throws for a value without a code', () => {
    expect(toStorageFailure(new Error('database is locked'))).toStrictEqual({ kind: 'busy' });
    expect(toStorageFailure(new Error('no such table: nope'))).toStrictEqual({
      kind: 'unknown',
      code: null,
    });
    expect(toStorageFailure(undefined)).toStrictEqual({ kind: 'unknown', code: null });
    expect(toStorageFailure({ errcode: 1 })).toStrictEqual({ kind: 'unknown', code: 1 });
  });
});
