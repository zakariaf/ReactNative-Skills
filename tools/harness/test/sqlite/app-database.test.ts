// test/sqlite/app-database.test.ts: opening the app database on real SQL: pragmas, snapshots, adoption, and every in-memory fallback.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { databaseStatusOf, openAppDatabase } from '@/data/app-database';
import { schemaOf } from '@/data/database-schema';
import { snapshotPathFor } from '@/data/database-snapshots';
import { MIGRATIONS } from '@/data/migrations/migrations';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { createNodeDatabaseFiles } from './node-database-files';
import { createNodeSqliteSqlDriver } from './node-sqlite-sql-driver';
import { makeTempDatabaseFolder } from './temp-database-folder';

import type { TempDatabaseFolder } from './temp-database-folder';
import type { Baseline, OpenAppDatabaseDeps } from '@/data/app-database';
import type { Migration } from '@/data/migrations/migration-runner';
import type { ClosableSqlDriver, SqlRunResult, SqlValue } from '@/data/sql-driver';
import type { FakeErrorLog } from '@/services/error-log/fake-error-log';

const CREATE_NOTES_SQL = 'CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT';
/** The open path is tested on its own small schema, so the test holds as the app adds versions. */
const CREATE_NOTES: Migration = {
  version: 1,
  name: 'create-notes',
  up: (driver) => {
    driver.exec(CREATE_NOTES_SQL);
  },
};
const ADD_NOTE_COLOR: Migration = {
  version: 2,
  name: 'add-note-color',
  up: (driver) => {
    driver.exec('ALTER TABLE notes ADD COLUMN color TEXT');
  },
};
const ADD_NOTE_PIN: Migration = {
  version: 3,
  name: 'add-note-pin',
  up: (driver) => {
    driver.exec('ALTER TABLE notes ADD COLUMN pinned INTEGER');
  },
};
/** An app before this layer: v1.0 created notes, v1.1 added pinned (ALTER TABLE on old installs). */
const NOTES_V10_SQL = 'CREATE TABLE notes (\n  id   INTEGER PRIMARY KEY,\n  body TEXT NOT NULL\n)';
const ADD_PINNED_SQL = 'ALTER TABLE notes ADD COLUMN pinned INTEGER DEFAULT 0';
const NOTES_V11_SQL =
  'CREATE TABLE notes (\n  id     INTEGER PRIMARY KEY,\n  body   TEXT NOT NULL,\n  pinned INTEGER DEFAULT 0\n)';
/** What sqlite_master holds after v1.0 then the ALTER: copied verbatim from that population's dump. */
const NOTES_ALTERED_DDL =
  'CREATE TABLE notes (\n  id   INTEGER PRIMARY KEY,\n  body TEXT NOT NULL\n, pinned INTEGER DEFAULT 0)';
const NOTES_BASELINE: Migration = {
  version: 1,
  name: 'notes-baseline',
  up: (driver) => {
    driver.exec(NOTES_V11_SQL);
  },
};
/** The rebuild after the baseline: every population ends with one STRICT table. */
const REBUILD_NOTES: Migration = {
  version: 2,
  name: 'rebuild-notes',
  rebuildsTables: true,
  up: (driver) => {
    driver.exec(`
CREATE TABLE notes_new (
  id     INTEGER PRIMARY KEY,
  body   TEXT    NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1))
) STRICT;
INSERT INTO notes_new (id, body, pinned) SELECT id, body, coalesce(pinned, 0) FROM notes;
DROP TABLE notes;
ALTER TABLE notes_new RENAME TO notes;
`);
  },
};
const LEGACY_BASELINE: Baseline = { version: 1, variants: [NOTES_ALTERED_DDL] };

const BROKEN_STEP: Migration = {
  version: 2,
  name: 'broken-step',
  up: () => {
    throw new Error('disk full');
  },
};

describe('openAppDatabase', () => {
  let folder: TempDatabaseFolder;
  let errorLog: FakeErrorLog;
  const deps = (migrations: readonly Migration[] = [CREATE_NOTES]): OpenAppDatabaseDeps => ({
    openDriver: (name) => createNodeSqliteSqlDriver(name === ':memory:' ? name : folder.file(name)),
    files: createNodeDatabaseFiles(),
    fileName: 'app.db',
    migrations,
    errorLog,
  });
  /** Reads or writes the file with a plain driver, as a second process would. */
  const readFile = (sql: string): unknown => {
    const driver = createNodeSqliteSqlDriver(folder.file('app.db'));
    const row = driver.get(sql, []);
    driver.close();
    return row;
  };
  const writeFile = (sql: string, name = 'app.db'): void => {
    const driver = createNodeSqliteSqlDriver(folder.file(name));
    driver.exec(sql);
    driver.close();
  };
  const snapshots = (): readonly string[] =>
    readdirSync(dirname(folder.file('app.db')))
      .filter((name) => name.endsWith('.bak'))
      .sort();
  beforeEach(() => {
    folder = makeTempDatabaseFolder();
    errorLog = createFakeErrorLog();
  });
  afterEach(() => {
    folder.remove();
  });

  it('creates a fresh database with the app migrations, WAL, synchronous FULL and foreign keys on', () => {
    const database = openAppDatabase(deps(MIGRATIONS));
    expect(database.outcome).toStrictEqual({ kind: 'fresh', version: MIGRATIONS.length });
    expect(database.isPersistent).toBe(true);
    expect(database.driver.get('PRAGMA journal_mode', [])).toStrictEqual({ journal_mode: 'wal' });
    expect(database.driver.get('PRAGMA synchronous', [])).toStrictEqual({ synchronous: 2 });
    expect(database.driver.get('PRAGMA foreign_keys', [])).toStrictEqual({ foreign_keys: 1 });
    expect(snapshots()).toStrictEqual([]);
  });

  it('opens a database at the latest version as ready, without a snapshot', () => {
    openAppDatabase(deps());
    expect(openAppDatabase(deps()).outcome).toStrictEqual({ kind: 'ready', version: 1 });
    expect(snapshots()).toStrictEqual([]);
  });

  it('snapshots an older database under its from-version before it migrates it', () => {
    openAppDatabase(deps());
    const snapshot = snapshotPathFor(folder.file('app.db'), 1);
    const database = openAppDatabase(deps([CREATE_NOTES, ADD_NOTE_COLOR]));
    expect(database.outcome).toStrictEqual({ kind: 'migrated', from: 1, to: 2, snapshot });
    const copy = createNodeSqliteSqlDriver(snapshot);
    expect(copy.get('PRAGMA user_version', [])).toStrictEqual({ user_version: 1 });
    copy.close();
  });

  it('reuses one snapshot while a step keeps failing, launch after launch', () => {
    openAppDatabase(deps());
    for (let launch = 0; launch < 5; launch += 1)
      openAppDatabase(deps([CREATE_NOTES, BROKEN_STEP]));
    expect(snapshots()).toStrictEqual(['app.db.v1.bak']);
  });

  it('replaces a partial snapshot left by a killed launch', () => {
    openAppDatabase(deps());
    writeFileSync(snapshotPathFor(folder.file('app.db'), 1), 'half a copy');
    const database = openAppDatabase(deps([CREATE_NOTES, ADD_NOTE_COLOR]));
    expect(database.outcome).toMatchObject({ kind: 'migrated', from: 1 });
    const copy = createNodeSqliteSqlDriver(snapshotPathFor(folder.file('app.db'), 1));
    expect(copy.get('PRAGMA user_version', [])).toStrictEqual({ user_version: 1 });
    copy.close();
  });

  it('keeps only the newest two snapshots after a successful upgrade', () => {
    const ADD_NOTE_ORDER: Migration = {
      version: 4,
      name: 'add-note-order',
      up: (driver) => {
        driver.exec('ALTER TABLE notes ADD COLUMN sort_order INTEGER');
      },
    };
    const steps = [CREATE_NOTES, ADD_NOTE_COLOR, ADD_NOTE_PIN, ADD_NOTE_ORDER];
    for (let latest = 1; latest <= steps.length; latest += 1)
      openAppDatabase(deps(steps.slice(0, latest)));
    expect(snapshots()).toStrictEqual(['app.db.v2.bak', 'app.db.v3.bak']);
  });

  it('refuses to migrate when no snapshot can be written', () => {
    openAppDatabase(deps());
    writeFileSync(snapshotPathFor(folder.file('app.db'), 1), 'taken');
    const files = {
      ...createNodeDatabaseFiles(),
      remove: () => {
        throw new Error('read-only folder');
      },
    };
    const database = openAppDatabase({ ...deps([CREATE_NOTES, ADD_NOTE_COLOR]), files });
    expect(database.outcome).toMatchObject({ kind: 'migration-failed', from: 1 });
    expect(JSON.stringify(database.outcome)).toContain('snapshot: ');
    expect(readFile('PRAGMA user_version')).toStrictEqual({ user_version: 1 });
  });

  it('leaves a file from a newer build untouched and runs the session in memory', () => {
    writeFile('CREATE TABLE notes_v9 (id INTEGER PRIMARY KEY) STRICT; PRAGMA user_version = 9;');
    const database = openAppDatabase(deps());
    database.driver.run('INSERT INTO notes (body) VALUES (?)', ['in memory only']);
    expect([database.outcome, database.isPersistent]).toStrictEqual([
      { kind: 'newer-version', found: 9 },
      false,
    ]);
    expect(readFile('PRAGMA user_version')).toStrictEqual({ user_version: 9 });
    expect(readFile('PRAGMA journal_mode')).toStrictEqual({ journal_mode: 'delete' });
  });

  it('keeps the file at its last version when a step fails, records the raw error, runs in memory', () => {
    openAppDatabase(deps());
    const database = openAppDatabase(deps([CREATE_NOTES, BROKEN_STEP]));
    expect(database.outcome).toStrictEqual({
      kind: 'migration-failed',
      from: 1,
      reason: 'disk full',
    });
    expect(database.isPersistent).toBe(false);
    expect(errorLog.recorded.map((entry) => entry.error)).toStrictEqual([new Error('disk full')]);
    expect(readFile('PRAGMA user_version')).toStrictEqual({ user_version: 1 });
  });

  it('names a step that runs out of space storage-full and keeps the file at its last version', () => {
    openAppDatabase(deps());
    writeFile("INSERT INTO notes (body) VALUES ('kept')");
    const FILL_NOTES: Migration = {
      version: 2,
      name: 'fill-notes',
      up: (driver) => {
        driver.exec(`
CREATE TABLE filler (body TEXT NOT NULL) STRICT;
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2000)
INSERT INTO filler (body) SELECT printf('%0500d', i) FROM n;
`);
      },
    };
    const database = openAppDatabase({
      ...deps([CREATE_NOTES, FILL_NOTES]),
      // A real SQLITE_FULL: the file may not grow past 16 pages on this connection.
      openDriver: (name) => {
        const driver = createNodeSqliteSqlDriver(name === ':memory:' ? name : folder.file(name));
        if (name === 'app.db') driver.exec('PRAGMA max_page_count = 16');
        return driver;
      },
    });
    expect(database.outcome).toMatchObject({ kind: 'storage-full', from: 1 });
    expect(database.isPersistent).toBe(false);
    expect(readFile('PRAGMA user_version')).toStrictEqual({ user_version: 1 });
    expect(readFile('SELECT COUNT(*) AS n FROM notes')).toStrictEqual({ n: 1 });
  });

  it('names a snapshot that fails on a full disk storage-full and runs no step', () => {
    openAppDatabase(deps());
    const fullDisk = (driver: ClosableSqlDriver): ClosableSqlDriver => ({
      ...driver,
      run: (sql: string, params: readonly SqlValue[]): SqlRunResult => {
        if (sql.startsWith('VACUUM INTO')) {
          throw Object.assign(new Error('database or disk is full'), { errcode: 13 });
        }
        return driver.run(sql, params);
      },
    });
    const database = openAppDatabase({
      ...deps([CREATE_NOTES, ADD_NOTE_COLOR]),
      openDriver: (name) => {
        const driver = createNodeSqliteSqlDriver(name === ':memory:' ? name : folder.file(name));
        return name === 'app.db' ? fullDisk(driver) : driver;
      },
    });
    expect(database.outcome).toStrictEqual({
      kind: 'storage-full',
      from: 1,
      reason: 'snapshot: database or disk is full',
    });
    expect(readFile('PRAGMA user_version')).toStrictEqual({ user_version: 1 });
    expect(snapshots()).toStrictEqual([]);
  });

  it('hands the app the status without the driver', () => {
    const status = databaseStatusOf(openAppDatabase(deps()));
    expect(Object.keys(status).sort()).toStrictEqual(['checkpoint', 'isPersistent', 'outcome']);
    expect(status.outcome).toStrictEqual({ kind: 'fresh', version: 1 });
  });

  it('opens a file that is not a database as unreadable and leaves its bytes alone', () => {
    const junk = 'not a database, just text that happens to sit where app.db belongs. '.repeat(20);
    writeFileSync(folder.file('app.db'), junk);
    const database = openAppDatabase(deps());
    expect(database.outcome).toMatchObject({ kind: 'unreadable' });
    expect(database.isPersistent).toBe(false);
    expect(readFileSync(folder.file('app.db'), 'utf8')).toBe(junk);
  });

  it('runs in memory as unreadable when the file cannot even be opened, whatever was thrown', () => {
    const refuse = (value: unknown): never => {
      throw value;
    };
    const database = openAppDatabase({
      ...deps(),
      openDriver: (name) =>
        name === ':memory:' ? createNodeSqliteSqlDriver(name) : refuse('sandbox denied'),
    });
    expect([database.outcome, database.isPersistent]).toStrictEqual([
      { kind: 'unreadable', reason: 'sandbox denied' },
      false,
    ]);
    expect(errorLog.recorded.map((entry) => entry.error)).toStrictEqual(['sandbox denied']);
    expect(database.driver.get('PRAGMA user_version', [])).toStrictEqual({ user_version: 1 });
  });

  it('leaves an unversioned file whose tables collide with migration 1 untouched, in memory', () => {
    writeFile(`${CREATE_NOTES_SQL}; INSERT INTO notes (body) VALUES ('kept');`);
    const database = openAppDatabase(deps());
    expect([database.outcome, database.isPersistent]).toStrictEqual([
      { kind: 'unversioned', tables: ['notes'] },
      false,
    ]);
    expect(readFile('SELECT body FROM notes')).toStrictEqual({ body: 'kept' });
    expect([readFile('PRAGMA journal_mode'), snapshots()]).toStrictEqual([
      { journal_mode: 'delete' },
      [],
    ]);
  });

  it('opens an unversioned file with unrelated tables in memory, never as fresh with its rows ignored', () => {
    writeFile("CREATE TABLE legacy_tasks (title TEXT); INSERT INTO legacy_tasks VALUES ('kept');");
    const database = openAppDatabase(deps());
    expect(database.outcome).toStrictEqual({ kind: 'unversioned', tables: ['legacy_tasks'] });
    expect(readFile('PRAGMA user_version')).toStrictEqual({ user_version: 0 });
    expect(errorLog.entries()).toStrictEqual([
      { atMs: 0, source: 'storage', message: 'unversioned database holds legacy_tasks' },
    ]);
  });

  it('adopts an unversioned file whose schema is exactly the baseline, after a snapshot', () => {
    writeFile(`${CREATE_NOTES_SQL}; INSERT INTO notes (body) VALUES ('kept');`);
    const database = openAppDatabase({
      ...deps([CREATE_NOTES, ADD_NOTE_COLOR]),
      baseline: { version: 1 },
    });
    const snapshot = snapshotPathFor(folder.file('app.db'), 0);
    expect(database.outcome).toStrictEqual({ kind: 'adopted', baseline: 1, to: 2, snapshot });
    expect(database.driver.get('SELECT body, color FROM notes', [])).toStrictEqual({
      body: 'kept',
      color: null,
    });
    expect(snapshots()).toStrictEqual(['app.db.v0.bak']);
  });

  it('does not adopt a file whose schema differs from the baseline by one character', () => {
    writeFile('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT) STRICT');
    const database = openAppDatabase({
      ...deps([CREATE_NOTES, ADD_NOTE_COLOR]),
      baseline: { version: 1 },
    });
    expect(database.outcome).toStrictEqual({ kind: 'unversioned', tables: ['notes'] });
  });

  it('keeps the population an ALTER TABLE wrote unversioned when its variant is not declared', () => {
    writeFile(`${NOTES_V10_SQL}; ${ADD_PINNED_SQL}; INSERT INTO notes (body) VALUES ('kept');`);
    const database = openAppDatabase({
      ...deps([NOTES_BASELINE, REBUILD_NOTES]),
      baseline: { version: 1 },
    });
    expect(database.outcome).toStrictEqual({ kind: 'unversioned', tables: ['notes'] });
    expect(readFile('SELECT body FROM notes')).toStrictEqual({ body: 'kept' });
  });

  it('adopts both populations old builds left (ALTER TABLE and a fresh CREATE), and the rebuild makes them one', () => {
    const legacy = { altered: `${NOTES_V10_SQL}; ${ADD_PINNED_SQL};`, fresh: `${NOTES_V11_SQL};` };
    const schemas = Object.entries(legacy).map(([population, sql]) => {
      writeFile(`${sql} INSERT INTO notes (body) VALUES ('kept');`, `${population}.db`);
      const database = openAppDatabase({
        ...deps([NOTES_BASELINE, REBUILD_NOTES]),
        fileName: `${population}.db`,
        baseline: LEGACY_BASELINE,
      });
      expect(database.outcome).toMatchObject({ kind: 'adopted', baseline: 1, to: 2 });
      expect(database.driver.get('SELECT body, pinned FROM notes', [])).toStrictEqual({
        body: 'kept',
        pinned: 0,
      });
      return schemaOf(database.driver);
    });
    expect(schemas[0]).toStrictEqual(schemas[1]);
  });

  it('folds the WAL into the file on checkpoint, and records instead of throwing when it cannot', () => {
    const opened: ClosableSqlDriver[] = [];
    const database = openAppDatabase({
      ...deps(),
      openDriver: (name) => {
        const driver = createNodeSqliteSqlDriver(folder.file(name));
        opened.push(driver);
        return driver;
      },
    });
    database.driver.run('INSERT INTO notes (body) VALUES (?)', ['on disk']);
    database.checkpoint();
    expect(database.driver.get('PRAGMA wal_checkpoint(PASSIVE)', [])).toStrictEqual({
      busy: 0,
      log: 0,
      checkpointed: 0,
    });
    opened.forEach((driver) => {
      driver.close();
    });
    expect(() => {
      database.checkpoint();
    }).not.toThrow();
    expect(errorLog.recorded).toHaveLength(1);
  });
});
