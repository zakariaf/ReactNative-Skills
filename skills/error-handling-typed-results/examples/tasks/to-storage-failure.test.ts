// test/integration/data/to-storage-failure.test.ts (example: a shape to imitate, never copied)
// Real SQL on node:sqlite (Node-API tests live in the root test/ folder, which has Node types), so the
// mapper is proven against the errors the engine really throws, not hand-written look-alikes. The
// device message forms are rebuilt from those real errors the way expo-sqlite 57 builds them.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { toStorageFailure } from '@/data/to-storage-failure';

function thrownBy(run: () => void): unknown {
  try {
    run();
  } catch (error: unknown) {
    return error;
  }
  throw new Error('expected the statement to throw');
}

/** The SQLite text of a real error (node:sqlite puts sqlite3_errmsg in message). */
function messageOf(thrown: unknown): string {
  const message: unknown =
    typeof thrown === 'object' && thrown !== null ? Reflect.get(thrown, 'message') : undefined;
  return typeof message === 'string' ? message : '';
}

/** How expo-modules-core wraps a native error (read from source, 57.0.20); only the tail is parsed. */
const IOS_PREFIX = "Calling the 'runSync' function has failed\n→ Caused by: ";
const ANDROID_PREFIX =
  "Call to function 'NativeStatement.runSync' has been rejected.\n→ Caused by: ";

describe('toStorageFailure', () => {
  const folder = mkdtempSync(join(tmpdir(), 'storage-failure-'));
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL UNIQUE)');
  db.prepare('INSERT INTO tasks (id, title) VALUES (?, ?)').run('task-1', 'Buy milk');

  afterAll(() => {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  });

  it('maps a primary-key clash from node:sqlite to a unique constraint on tasks.id', () => {
    const thrown = thrownBy(() => db.prepare('INSERT INTO tasks VALUES (?, ?)').run('task-1', 'x'));

    expect(toStorageFailure(thrown)).toStrictEqual({
      kind: 'constraint',
      detail: 'unique',
      columns: ['tasks.id'],
    });
  });

  it('names the title column for a duplicate title, so the repository can tell it from an id clash', () => {
    const thrown = thrownBy(() =>
      db.prepare('INSERT INTO tasks VALUES (?, ?)').run('task-9', 'Buy milk'),
    );

    expect(toStorageFailure(thrown)).toStrictEqual({
      kind: 'constraint',
      detail: 'unique',
      columns: ['tasks.title'],
    });
  });

  it('maps a NOT NULL violation', () => {
    const thrown = thrownBy(() =>
      db.prepare('INSERT INTO tasks VALUES (?, ?)').run('task-2', null),
    );

    expect(toStorageFailure(thrown)).toStrictEqual({
      kind: 'constraint',
      detail: 'not-null',
      columns: ['tasks.title'],
    });
  });

  it('maps a full database (max_page_count reached)', () => {
    const small = new DatabaseSync(':memory:');
    small.exec('CREATE TABLE blobs (data BLOB)');
    const { page_count: pages } = small.prepare('PRAGMA page_count').get() as {
      page_count: number;
    };
    small.exec(`PRAGMA max_page_count = ${String(pages)}`);

    const thrown = thrownBy(() =>
      small.prepare('INSERT INTO blobs VALUES (?)').run(new Uint8Array(65_536)),
    );

    expect(toStorageFailure(thrown)).toStrictEqual({ kind: 'full' });
    small.close();
  });

  it('maps a database another connection holds locked to busy', () => {
    const file = join(folder, 'locked.db');
    const holder = new DatabaseSync(file);
    holder.exec('CREATE TABLE tasks (id TEXT)');
    holder.exec('BEGIN EXCLUSIVE');
    const writer = new DatabaseSync(file, { timeout: 0 });

    const thrown = thrownBy(() => {
      writer.exec("INSERT INTO tasks VALUES ('task-1')");
    });

    expect(toStorageFailure(thrown)).toStrictEqual({ kind: 'busy' });
    holder.exec('ROLLBACK');
    writer.close();
    holder.close();
  });

  it('maps a foreign-key violation from node:sqlite (foreign keys on, a task in a missing list)', () => {
    const linked = new DatabaseSync(':memory:');
    linked.exec('PRAGMA foreign_keys = ON');
    linked.exec('CREATE TABLE lists (id TEXT PRIMARY KEY)');
    linked.exec(
      'CREATE TABLE tasks (id TEXT PRIMARY KEY, list_id TEXT NOT NULL REFERENCES lists (id))',
    );

    const thrown = thrownBy(() =>
      linked.prepare('INSERT INTO tasks VALUES (?, ?)').run('task-1', 'no-such-list'),
    );
    linked.close();

    expect(messageOf(thrown)).toBe('FOREIGN KEY constraint failed');
    expect(toStorageFailure(thrown)).toStrictEqual({
      kind: 'constraint',
      detail: 'foreign-key',
      columns: [],
    });
  });

  it('maps a file that is not a database to corrupt', () => {
    const file = join(folder, 'junk.db');
    writeFileSync(file, 'x'.repeat(4096));
    const junk = new DatabaseSync(file);

    const thrown = thrownBy(() => {
      junk.exec('SELECT * FROM sqlite_master');
    });
    junk.close();

    expect(toStorageFailure(thrown)).toStrictEqual({ kind: 'corrupt' });
  });

  it('reads the decimal code of the iOS message form', () => {
    const real = thrownBy(() => db.prepare('INSERT INTO tasks VALUES (?, ?)').run('task-3', null));
    const fromIos = new Error(`${IOS_PREFIX}Error code 19: ${messageOf(real)}`);

    expect(toStorageFailure(fromIos)).toStrictEqual({
      kind: 'constraint',
      detail: 'not-null',
      columns: ['tasks.title'],
    });
  });

  it('reads the one-character code of the Android message form', () => {
    const real = thrownBy(() =>
      db.prepare('INSERT INTO tasks VALUES (?, ?)').run('task-4', 'Buy milk'),
    );
    const fromAndroid = new Error(
      `${ANDROID_PREFIX}Error code ${String.fromCharCode(19)}: ${messageOf(real)}`,
    );

    expect(messageOf(real)).toBe('UNIQUE constraint failed: tasks.title');
    expect(toStorageFailure(fromAndroid)).toStrictEqual({
      kind: 'constraint',
      detail: 'unique',
      columns: ['tasks.title'],
    });
    expect(toStorageFailure(new Error(`Error code ${String.fromCharCode(13)}: x`))).toStrictEqual({
      kind: 'full',
    });
  });

  it('falls back to the SQLite message text when no code can be read', () => {
    // A wrapper that kept only sqlite3_errmsg (no errcode, no "Error code" prefix): the text decides.
    const real = thrownBy(() => db.prepare('INSERT INTO tasks VALUES (?, ?)').run('task-5', null));

    expect(toStorageFailure(new Error(messageOf(real)))).toStrictEqual({
      kind: 'constraint',
      detail: 'not-null',
      columns: ['tasks.title'],
    });
    expect(toStorageFailure(new Error('database is locked'))).toStrictEqual({ kind: 'busy' });
    expect(toStorageFailure(new Error('file is not a database'))).toStrictEqual({
      kind: 'corrupt',
    });
  });

  it('returns unknown, never throws, for values that carry no code', () => {
    expect(toStorageFailure(new Error('no such table: nope'))).toStrictEqual({
      kind: 'unknown',
      code: null,
    });
    expect(toStorageFailure(undefined)).toStrictEqual({ kind: 'unknown', code: null });
    expect(toStorageFailure({ errcode: 1 })).toStrictEqual({ kind: 'unknown', code: 1 });
  });
});
